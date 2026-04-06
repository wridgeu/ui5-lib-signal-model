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
  private _resubscribeCb: (() => void) | null = null;
  private _subscribedPath: string | null = null;

  /** @since 0.1.0 */
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

  /** @since 0.1.0 */
  override initialize(): this {
    if (!this.watcher) {
      this.subscribe();
    }
    // Fire initial change so controls (e.g. sap.m.Tree) populate their aggregation
    asInternal(this)._fireChange({ reason: ChangeReason.Change });
    return this;
  }

  /** @since 0.1.0 */
  setContext(context?: object): void {
    const internal = asInternal(this);
    if (internal.oContext !== context) {
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
