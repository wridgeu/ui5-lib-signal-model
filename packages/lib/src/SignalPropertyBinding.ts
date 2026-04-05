import ClientPropertyBinding from "sap/ui/model/ClientPropertyBinding";
import ChangeReason from "sap/ui/model/ChangeReason";
import type Context from "sap/ui/model/Context";
import { Signal } from "signal-polyfill";
import type SignalModel from "./SignalModel";
import { scheduleFlush, cancelFlush, teardownWatcher } from "./FlushQueue";

// Runtime properties/methods not exposed by @openui5/types.
// setValue and initialize are @ui5-protected on PropertyBinding and don't need casting.
type ClientPropertyBindingInternal = ClientPropertyBinding & {
  bSuspended: boolean;
  oValue: unknown;
  oContext: Context | undefined;
  sPath: string;
  checkUpdate(bForceUpdate?: boolean): void;
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
  private _resubscribeCb: (() => void) | null = null;
  private _subscribedPath: string | null = null;

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

    const signal = this.oModel.getSignal(resolvedPath);

    this.watcher = new Signal.subtle.Watcher(() => {
      scheduleFlush(this, signal);
    });
    this.watcher.watch(signal);

    this._subscribedPath = resolvedPath;
    this._resubscribeCb = () => this.subscribe();
    this.oModel._onPathResubscribe(resolvedPath, this._resubscribeCb);
  }

  unsubscribe(): void {
    if (this._resubscribeCb && this._subscribedPath) {
      this.oModel._offPathResubscribe(this._subscribedPath, this._resubscribeCb);
      this._resubscribeCb = null;
      this._subscribedPath = null;
    }
    cancelFlush(this);
    this.watcher = teardownWatcher(this.watcher);
  }

  override initialize(): this {
    if (!this.watcher) {
      this.subscribe();
    }
    this.checkUpdate(true);
    return this;
  }

  setContext(oContext?: Context): void {
    const self = asInternal(this);
    if (self.oContext != oContext) {
      const oldResolved = this.getResolvedPath();
      self.oContext = oContext;
      if (this.isRelative()) {
        this.checkUpdate();
      }
      const newResolved = this.getResolvedPath();
      if (oldResolved !== newResolved) {
        this.subscribe();
      }
    }
  }

  override destroy(): void {
    this.unsubscribe();
    super.destroy();
  }
}
