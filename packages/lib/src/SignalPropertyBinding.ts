import ClientPropertyBinding from "sap/ui/model/ClientPropertyBinding";
import ChangeReason from "sap/ui/model/ChangeReason";
import type Context from "sap/ui/model/Context";
import deepEqual from "sap/base/util/deepEqual";
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
  checkUpdate(forceUpdate?: boolean): void;
  getDataState(): { setValue(v: unknown): void; getControlMessages(): unknown[] };
  checkDataState(): void;
  _getValue(): unknown;
  _fireChange(event: { reason: ChangeReason }): void;
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
 * @since 0.1.0
 */
export default class SignalPropertyBinding extends ClientPropertyBinding {
  declare oModel: SignalModel;
  watcher: Signal.subtle.Watcher | null = null;
  private _resubscribeCb: (() => void) | null = null;
  private _subscribedPath: string | null = null;

  /**
   * @param forceUpdate - Whether to force a change event regardless of value comparison.
   * @since 0.1.0
   */
  checkUpdate(forceUpdate?: boolean): void {
    const self = asInternal(this);
    if (self.bSuspended && !forceUpdate) {
      return;
    }

    const value = self._getValue();
    // For objects, always fire - the reference may be the same but contents may have changed
    // (mutation through setProperty on child paths). For primitives, use strict equality.
    const hasChanged = typeof value === "object" && value !== null ? true : self.oValue !== value;
    if (hasChanged || forceUpdate) {
      self.oValue = value;
      self.getDataState().setValue(self.oValue);
      self.checkDataState();
      self._fireChange({ reason: ChangeReason.Change });
    }
  }

  /**
   * @param value - The new value to set on the bound property.
   * @since 0.1.0
   */
  setValue(value: unknown): void {
    const self = asInternal(this);
    if (self.bSuspended) {
      return;
    }

    if (!deepEqual(self.oValue, value)) {
      if (this.oModel.setProperty(self.sPath, value, self.oContext, true)) {
        self.oValue = value;
        self.getDataState().setValue(self.oValue);
        this.oModel.firePropertyChange({
          reason: ChangeReason.Binding,
          path: self.sPath,
          context: self.oContext,
          value,
        });
      }
    }
  }

  /** @since 0.1.0 */
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

  /** @since 0.1.0 */
  unsubscribe(): void {
    if (this._resubscribeCb && this._subscribedPath) {
      this.oModel._offPathResubscribe(this._subscribedPath, this._resubscribeCb);
      this._resubscribeCb = null;
      this._subscribedPath = null;
    }
    cancelFlush(this);
    this.watcher = teardownWatcher(this.watcher);
  }

  /**
   * @returns The binding instance for chaining.
   * @since 0.1.0
   */
  override initialize(): this {
    if (!this.watcher) {
      this.subscribe();
    }
    this.checkUpdate(true);
    return this;
  }

  /**
   * @param context - The new binding context.
   * @since 0.1.0
   */
  setContext(context?: Context): void {
    const self = asInternal(this);
    if (self.oContext != context) {
      // Match ClientPropertyBinding: clear stale control messages before context switch
      const Messaging = sap.ui.require("sap/ui/core/Messaging") as
        | { removeMessages(messages: unknown[], keepMessages: boolean): void }
        | undefined;
      if (Messaging) {
        Messaging.removeMessages(self.getDataState().getControlMessages(), true);
      }
      const oldResolved = this.getResolvedPath();
      self.oContext = context;
      if (this.isRelative()) {
        this.checkUpdate();
      }
      const newResolved = this.getResolvedPath();
      if (oldResolved !== newResolved) {
        this.subscribe();
      }
    }
  }

  /** @since 0.1.0 */
  override destroy(): void {
    this.unsubscribe();
    super.destroy();
  }
}
