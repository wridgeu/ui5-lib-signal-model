import ClientTreeBinding from "sap/ui/model/ClientTreeBinding";
import ChangeReason from "sap/ui/model/ChangeReason";
import type Context from "sap/ui/model/Context";
import deepEqual from "sap/base/util/deepEqual";
import { Signal } from "signal-polyfill";
import type SignalModel from "./SignalModel";
import { scheduleFlush, cancelFlush, teardownWatcher } from "./FlushQueue";

// Runtime properties/methods not exposed by @openui5/types.
// getResolvedPath, isRelative are on the public API and don't need casting.
type TreeBindingInternal = ClientTreeBinding & {
  sPath: string;
  oContext: Context | undefined;
  oTreeData: unknown;
  _mLengthsCache: Record<string, number>;
  applyFilter(): void;
  cloneData(data: unknown): unknown;
  _fireChange(params: { reason: string }): void;
};

/**
 * Casts to an internal type that includes UI5 runtime properties not exposed
 * by `@openui5/types` (e.g. `sPath`, `oTreeData`, `_fireChange`).
 */
function asInternal(self: SignalTreeBinding): TreeBindingInternal {
  return self as unknown as TreeBindingInternal;
}

/**
 * Tree binding that subscribes to a signal for push-based change notification.
 * Reuses ClientTreeBinding's filter/sort/tree traversal logic.
 *
 * @namespace ui5.model.signal
 * @since 0.1.0
 */
export default class SignalTreeBinding extends ClientTreeBinding {
  declare oModel: SignalModel;
  watcher: Signal.subtle.Watcher | null = null;
  private _subscribedPath: string | null = null;

  /**
   * @param forceUpdate - Whether to force a change event regardless of data comparison.
   * @since 0.1.0
   */
  checkUpdate(forceUpdate?: boolean): void {
    const internal = asInternal(this);
    // No bSuspended guard: ClientTreeBinding/JSONTreeBinding do not support
    // suspend/resume. The base Binding.suspend() sets the flag but tree
    // bindings ignore it. We match that behavior for parity.
    //
    // Match ClientTreeBinding.checkUpdate: reapply filters, clear length cache,
    // and only fire change when data actually changed (or forced).
    const currentTreeData = this.oModel._getObject(internal.sPath, internal.oContext);
    internal.applyFilter();
    internal._mLengthsCache = {};
    if (forceUpdate || !deepEqual(internal.oTreeData, currentTreeData)) {
      internal.oTreeData = internal.cloneData(currentTreeData);
      internal._fireChange({ reason: ChangeReason.Change });
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
    if (!resolvedPath) return;

    const signal = this.oModel._getSignal(resolvedPath);

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
    // Fire initial change so controls (e.g. sap.m.Tree) populate their aggregation; not
    // while suspended, as Binding.initialize
    if (!this.isSuspended()) asInternal(this)._fireChange({ reason: ChangeReason.Change });
    return this;
  }

  /**
   * @param context - The new binding context.
   * @since 0.1.0
   */
  setContext(context?: object): void {
    const internal = asInternal(this);
    if (internal.oContext != context) {
      internal.oContext = context as Context;
      if (this.isRelative()) {
        // Match ClientTreeBinding.setContext: snapshot tree data for the new context
        const treeData = this.oModel._getObject(internal.sPath, internal.oContext);
        internal.oTreeData = internal.cloneData(treeData);
        this.subscribe();
        internal._fireChange({ reason: ChangeReason.Context });
      }
    }
  }

  /** @since 0.1.0 */
  override destroy(): void {
    this.unsubscribe();
    super.destroy();
  }
}
