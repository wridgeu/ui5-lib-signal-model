import ClientListBinding from "sap/ui/model/ClientListBinding";
import ChangeReason from "sap/ui/model/ChangeReason";
import type Context from "sap/ui/model/Context";
import { Signal } from "signal-polyfill";
import type SignalModel from "./SignalModel";
import { scheduleFlush, cancelFlush, teardownWatcher } from "./FlushQueue";

// Runtime properties/methods not exposed by @openui5/types.
// getResolvedPath, isRelative are on the public API and don't need casting.
type ListBindingInternal = ClientListBinding & {
  oList: unknown[] | Record<string, unknown>;
  aIndices: (number | string)[];
  iLength: number;
  bUseExtendedChangeDetection: boolean;
  sPath: string;
  oContext: Context | undefined;
  bSuspended: boolean;
  bIgnoreSuspend: boolean;
  updateIndices(): void;
  applyFilter(): void;
  applySort(): void;
  _getLength(): number;
  _fireChange(params: { reason: string }): void;
};

/**
 * Casts to an internal type that includes UI5 runtime properties not exposed
 * by `@openui5/types` (e.g. `oList`, `bSuspended`, `_fireChange`).
 */
function asInternal(self: SignalListBinding): ListBindingInternal {
  return self as unknown as ListBindingInternal;
}

/**
 * List binding that subscribes to a signal for push-based change notification.
 * Reuses ClientListBinding's filter/sort/extended-change-detection.
 *
 * @namespace ui5.model.signal
 */
export default class SignalListBinding extends ClientListBinding {
  declare oModel: SignalModel;
  watcher: Signal.subtle.Watcher | null = null;
  private _resubscribeCb: (() => void) | null = null;
  private _subscribedPath: string | null = null;

  update(): void {
    const internal = asInternal(this);
    const oList = this.oModel._getObject(internal.sPath, internal.oContext);
    if (oList) {
      if (Array.isArray(oList)) {
        internal.oList = internal.bUseExtendedChangeDetection
          ? (structuredClone(oList) as unknown[])
          : oList.slice();
      } else {
        internal.oList = internal.bUseExtendedChangeDetection
          ? (structuredClone(oList) as Record<string, unknown>)
          : Object.assign({}, oList);
      }
      this.updateIndices();
      internal.applyFilter();
      internal.applySort();
      internal.iLength = internal._getLength();
    } else {
      internal.oList = [];
      internal.aIndices = [];
      internal.iLength = 0;
    }
  }

  /**
   * Override ClientListBinding.updateIndices to handle both arrays and objects.
   * ClientListBinding only handles arrays (numeric indices). JSONListBinding
   * overrides this to also handle objects (string keys via for...in).
   */
  updateIndices(): void {
    const internal = asInternal(this);
    internal.aIndices = [];
    if (Array.isArray(internal.oList)) {
      for (let i = 0; i < internal.oList.length; i++) {
        internal.aIndices.push(i);
      }
    } else {
      for (const key in internal.oList) {
        internal.aIndices.push(key);
      }
    }
  }

  checkUpdate(bForceUpdate?: boolean): void {
    const internal = asInternal(this);
    if (internal.bSuspended && !internal.bIgnoreSuspend && !bForceUpdate) {
      return;
    }
    this.update();
    internal._fireChange({ reason: ChangeReason.Change });
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
    this.update();
    if (!this.watcher) {
      this.subscribe();
    }
    // Fire initial change so controls (e.g. sap.m.List) populate their aggregation
    asInternal(this)._fireChange({ reason: ChangeReason.Change });
    return this;
  }

  setContext(oContext?: object): void {
    const internal = asInternal(this);
    if (internal.oContext !== oContext) {
      internal.oContext = oContext as Context;
      if (this.isRelative()) {
        this.update();
        this.subscribe();
        internal._fireChange({ reason: ChangeReason.Context });
      }
    }
  }

  override destroy(): void {
    this.unsubscribe();
    super.destroy();
  }
}
