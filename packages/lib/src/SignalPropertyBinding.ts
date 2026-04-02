import ClientPropertyBinding from "sap/ui/model/ClientPropertyBinding";
import ChangeReason from "sap/ui/model/ChangeReason";
import Context from "sap/ui/model/Context";
import { Signal } from "signal-polyfill";
import type SignalModel from "./SignalModel";

// Type alias for the undeclared internal shape of the base class at runtime
type ClientPropertyBindingInternal = ClientPropertyBinding & {
  bSuspended: boolean;
  oValue: unknown;
  oContext: Context | undefined;
  sPath: string;
  checkUpdate(bForceUpdate?: boolean): void;
  setValue(oValue: unknown): void;
  initialize(): ClientPropertyBindingInternal;
  setContext(oContext?: Context): void;
  getDataState(): { setValue(v: unknown): void };
  checkDataState(): void;
  _getValue(): unknown;
  _fireChange(oEvent: { reason: ChangeReason }): void;
};

/** Cast `this` to access undeclared UI5 internals. */
function asInternal(self: SignalPropertyBinding): ClientPropertyBindingInternal {
  return self as unknown as ClientPropertyBindingInternal;
}

// Microtask batching: collect all pending binding updates and process them
// in a single microtask instead of scheduling one microtask per signal change.
const pendingUpdates = new Map<
  SignalPropertyBinding,
  Signal.State<unknown> | Signal.Computed<unknown>
>();
let flushScheduled = false;

function scheduleFlush(): void {
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      const entries = [...pendingUpdates.entries()];
      pendingUpdates.clear();
      for (const [binding, signal] of entries) {
        signal.get();
        binding.watcher?.watch();
        binding.checkUpdate();
      }
    });
  }
}

/**
 * Property binding that subscribes to a signal for push-based change notification.
 *
 * @namespace ui5.model.signal
 */
export default class SignalPropertyBinding extends ClientPropertyBinding {
  declare oModel: SignalModel;
  watcher: Signal.subtle.Watcher | null = null;

  checkUpdate(bForceUpdate?: boolean): void {
    const self = asInternal(this);
    if (self.bSuspended && !bForceUpdate) {
      return;
    }

    const oValue = self._getValue();
    // For objects, always fire - the reference may be the same but contents may have changed
    // (mutation through setProperty on child paths). For primitives, use strict equality.
    const hasChanged =
      typeof oValue === "object" && oValue !== null ? true : self.oValue !== oValue;
    if (hasChanged || bForceUpdate) {
      self.oValue = oValue;
      self.getDataState().setValue(self.oValue);
      self.checkDataState();
      self._fireChange({ reason: ChangeReason.Change });
    }
  }

  setValue(oValue: unknown): void {
    const self = asInternal(this);
    if (self.bSuspended) {
      return;
    }

    if (self.oValue !== oValue) {
      this.oModel.setProperty(self.sPath, oValue, self.oContext, true);
      self.oValue = oValue;
      self.getDataState().setValue(self.oValue);
      this.oModel.firePropertyChange({
        reason: ChangeReason.Binding,
        path: self.sPath,
        context: self.oContext,
        value: oValue,
      });
    }
  }

  subscribe(): void {
    this.unsubscribe();

    const resolvedPath = this.getResolvedPath();
    if (!resolvedPath) return;

    const self = asInternal(this);
    const signal = this.oModel._getOrCreateSignal(resolvedPath, self._getValue());

    this.watcher = new Signal.subtle.Watcher(() => {
      pendingUpdates.set(this, signal);
      scheduleFlush();
    });
    this.watcher.watch(signal);
  }

  unsubscribe(): void {
    pendingUpdates.delete(this);
    if (this.watcher) {
      const sources = Signal.subtle.introspectSources(this.watcher);
      if (sources.length) {
        this.watcher.unwatch(...sources);
      }
      this.watcher = null;
    }
  }

  initialize(): this {
    this.subscribe();
    this.checkUpdate(true);
    return this;
  }

  setContext(oContext?: Context): void {
    const self = asInternal(this);
    if (self.oContext !== oContext) {
      const oldResolved = this.getResolvedPath();
      // Delegate to the prototype's setContext if available
      const proto = Object.getPrototypeOf(
        Object.getPrototypeOf(this),
      ) as ClientPropertyBindingInternal;
      if (typeof proto.setContext === "function") {
        proto.setContext.call(this, oContext);
      } else {
        self.oContext = oContext;
      }
      const newResolved = this.getResolvedPath();
      if (oldResolved !== newResolved && newResolved) {
        this.subscribe();
      }
    }
  }

  override destroy(): void {
    this.unsubscribe();
    super.destroy();
  }
}
