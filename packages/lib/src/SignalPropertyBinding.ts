import ClientPropertyBinding from "sap/ui/model/ClientPropertyBinding";
import ChangeReason from "sap/ui/model/ChangeReason";
import Context from "sap/ui/model/Context";
import { Signal } from "signal-polyfill";
import type SignalModel from "./SignalModel";
import { scheduleFlush, cancelFlush } from "./FlushQueue";

// Runtime properties/methods not exposed by @openui5/types.
// setValue and initialize are @ui5-protected on PropertyBinding and don't need casting.
// setContext exists at runtime on PropertyBinding.prototype but is missing from type stubs.
type ClientPropertyBindingInternal = ClientPropertyBinding & {
  bSuspended: boolean;
  oValue: unknown;
  oContext: Context | undefined;
  sPath: string;
  checkUpdate(bForceUpdate?: boolean): void;
  setContext(oContext?: Context): void;
  getDataState(): { setValue(v: unknown): void };
  checkDataState(): void;
  _getValue(): unknown;
  _fireChange(oEvent: { reason: ChangeReason }): void;
};

/**
 * Casts to an internal type that includes UI5 runtime properties not exposed
 * by `@openui5/types` (e.g. `oValue`, `bSuspended`, `_fireChange`).
 */
function asInternal(self: SignalPropertyBinding): ClientPropertyBindingInternal {
  return self as unknown as ClientPropertyBindingInternal;
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
      scheduleFlush(this, signal);
    });
    this.watcher.watch(signal);
  }

  unsubscribe(): void {
    cancelFlush(this);
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
      // Walk the prototype chain to reach ClientPropertyBinding.prototype.setContext.
      // Assumes: SignalPropertyBinding → ClientPropertyBinding → PropertyBinding.
      // Falls back to direct context assignment if the chain differs.
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
