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
  private _subscribedPath: string | null = null;
  private _previousResolvedPath: string | undefined = undefined;
  private _isDirectSignal = false;
  /** The object written by setValue, while the model still has to tell of that write */
  private _shown: unknown = undefined;

  /**
   * @param forceUpdate - Whether to force a change event regardless of value comparison.
   * @since 0.1.0
   */
  checkUpdate(forceUpdate?: boolean): void {
    const self = asInternal(this);
    if (self.bSuspended && !forceUpdate) {
      return;
    }

    this._shown = undefined;
    const value = self._getValue();
    // No signal has reported a write here, so the values are compared as in JSONModel
    this._applyUpdate(self, value, forceUpdate || !deepEqual(value, self.oValue));
  }

  /**
   * Fast-path update invoked by FlushQueue with the already-read signal value.
   * Avoids redundant getProperty/_getObject traversal when watching the exact bound path.
   *
   * @internal
   */
  _checkUpdateFromSignal(signalValue: unknown): void {
    const self = asInternal(this);
    if (self.bSuspended) {
      return;
    }

    // Whatever the binding hears, what it showed before is no longer the news
    this._shown = undefined;
    const value = this._isDirectSignal ? signalValue : self._getValue();
    // An object stays the same object when something below it is written
    const changed = (typeof value === "object" && value !== null) || !Object.is(self.oValue, value);
    this._applyUpdate(self, value, changed);
  }

  /**
   * Asked once when the model tells of an asynchronous write: whether this binding shows
   * that object already. Only that one notification is skipped, a write below the object
   * is told as ever.
   *
   * @internal
   */
  _showsAlready(value: unknown): boolean {
    const shown = this._shown;
    this._shown = undefined;
    return typeof value === "object" && value !== null && value === shown;
  }

  private _applyUpdate(
    self: ClientPropertyBindingInternal,
    value: unknown,
    hasChanged: boolean,
  ): void {
    const isRelative = this.isRelative();
    const currentResolvedPath = isRelative ? this.getResolvedPath() : undefined;
    const pathChanged = isRelative && this._previousResolvedPath !== currentResolvedPath;

    if (hasChanged || pathChanged) {
      self.oValue = value;
      self.getDataState().setValue(self.oValue);
      self.checkDataState();
      if (isRelative) {
        this._previousResolvedPath = currentResolvedPath;
      }
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
    // A write the binding has not heard of yet is told first, as JSONModel has done by
    // now: the value is compared with what the binding shows
    if (cancelFlush(this)) this.checkUpdate();

    if (!deepEqual(self.oValue, value)) {
      if (this.oModel.setProperty(self.sPath, value, self.oContext, true)) {
        self.oValue = value;
        // The model tells of this write later: no event for the binding that made it
        this._shown = value;
        self.getDataState().setValue(self.oValue);
        this.oModel.firePropertyChange({
          reason: ChangeReason.Binding,
          path: self.sPath,
          context: self.oContext,
          value,
        });
        // The model can hold something else than was written, e.g. the length of an array
        if (!Object.is(self._getValue(), value)) {
          // A propertyChange handler wrote to the path: the check covers that write. Before
          // the check, whose change handlers may write again.
          cancelFlush(this);
          this.checkUpdate();
          // What it shows now is what the model will tell of
          this._shown = self.oValue;
        }
      }
    }
  }

  /**
   * Checks the binding against the data, as in JSONModel. The data may have changed without
   * the model, so the signals at the binding's path and below it are brought in line first;
   * otherwise a later write of the value they still hold would be no change.
   *
   * @param forceUpdate - Whether to fire a change event regardless of value comparison.
   */
  override refresh(forceUpdate?: boolean): void {
    // As JSONModel: a suspended binding does nothing unless forced
    if (this.isSuspended() && !forceUpdate) return;
    if (this._subscribedPath) {
      this.oModel._syncSignals(this._subscribedPath);
      // The check below covers this binding: a queued update would be a second event
      cancelFlush(this);
      this.watcher?.watch();
    }
    super.refresh(forceUpdate);
  }

  /** Whether the model holds the binding: it has a change handler. @internal */
  _held = false;
  /** The model's count of writes when the binding last heard of them. @internal */
  _seenWrites = 0;

  /** @since 0.1.0 */
  subscribe(): void {
    this.unsubscribe();
    if (!this._held) return;

    const resolvedPath = this.getResolvedPath();
    if (this.isRelative()) {
      this._previousResolvedPath = resolvedPath;
    }
    if (!resolvedPath) return;

    const signal = this.oModel._getSignal(resolvedPath);
    const self = asInternal(this);
    const propName = self.sPath.substring(self.sPath.lastIndexOf("/") + 1);
    this._isDirectSignal =
      propName !== "__name__" && this.oModel._getExactSignal(resolvedPath) === signal;

    // The model tells the bindings on a state signal itself; only a computed needs a watcher
    if (!(signal instanceof Signal.State)) {
      this.watcher = new Signal.subtle.Watcher(() => {
        scheduleFlush(this, signal);
      });
      this.watcher.watch(signal);
    }

    this._subscribedPath = resolvedPath;
    this.oModel._subscribe(resolvedPath, this);
  }

  /** @since 0.1.0 */
  unsubscribe(): void {
    if (this._subscribedPath) {
      this.oModel._unsubscribe(this._subscribedPath, this);
      this._subscribedPath = null;
    }
    this._isDirectSignal = false;
    this._shown = undefined;
    cancelFlush(this);
    this.watcher = teardownWatcher(this.watcher);
  }

  /**
   * @returns The binding instance for chaining.
   * @since 0.1.0
   */
  override initialize(): this {
    if (!this._subscribedPath) {
      this.subscribe();
    }
    // Not while suspended, as Binding.initialize. This is the check: an update queued for
    // the binding would be a second event.
    if (!asInternal(this).bSuspended) {
      cancelFlush(this);
      this.checkUpdate(true);
    }
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
      const newResolved = this.getResolvedPath();
      // Before the check: a change handler may write to the new path
      if (oldResolved !== newResolved) {
        this.subscribe();
        // The check still has to see that the path changed
        this._previousResolvedPath = oldResolved;
      }
      if (this.isRelative()) {
        this.checkUpdate();
      }
    }
  }

  /** @since 0.1.0 */
  override destroy(): void {
    this.unsubscribe();
    super.destroy();
  }
}
