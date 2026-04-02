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

// Shared watcher: one Watcher instance for all property bindings.
// Reverse map from signal to bindings allows O(1) lookup on flush.
type AnySignal = Signal.State<unknown> | Signal.Computed<unknown>;
const signalToBindings = new Map<AnySignal, Set<SignalPropertyBinding>>();
let flushScheduled = false;

const sharedWatcher = new Signal.subtle.Watcher(() => {
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flush);
  }
});

function flush(): void {
  flushScheduled = false;
  // Get all dirty signals and re-evaluate them in bulk
  const pending = sharedWatcher.getPending();
  for (const s of pending) {
    s.get();
  }
  // Re-arm the watcher for all watched signals in one call
  sharedWatcher.watch();
  // Now fire UI5 binding updates for the affected bindings
  for (const s of pending) {
    const bindings = signalToBindings.get(s as AnySignal);
    if (bindings) {
      for (const binding of bindings) {
        binding.checkUpdate();
      }
    }
  }
}

/**
 * Property binding that subscribes to a signal for push-based change notification.
 *
 * @namespace ui5.model.signal
 */
export default class SignalPropertyBinding extends ClientPropertyBinding {
  declare oModel: SignalModel;
  private watchedSignal: AnySignal | null = null;

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
    this.watchedSignal = signal;

    // Register in reverse map
    let bindings = signalToBindings.get(signal);
    if (!bindings) {
      bindings = new Set();
      signalToBindings.set(signal, bindings);
    }
    bindings.add(this);

    // Watch via shared watcher
    sharedWatcher.watch(signal);
  }

  unsubscribe(): void {
    if (this.watchedSignal) {
      const bindings = signalToBindings.get(this.watchedSignal);
      if (bindings) {
        bindings.delete(this);
        if (bindings.size === 0) {
          signalToBindings.delete(this.watchedSignal);
          sharedWatcher.unwatch(this.watchedSignal);
        }
      }
      this.watchedSignal = null;
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
