import ClientTreeBinding from "sap/ui/model/ClientTreeBinding";
import ChangeReason from "sap/ui/model/ChangeReason";
import type Context from "sap/ui/model/Context";
import { Signal } from "signal-polyfill";
import type SignalModel from "./SignalModel";
import { scheduleFlush, cancelFlush } from "./FlushQueue";

// Runtime properties/methods not exposed by @openui5/types.
// getResolvedPath, isRelative are on the public API and don't need casting.
type TreeBindingInternal = ClientTreeBinding & {
  sPath: string;
  oContext: Context | undefined;
  oModel: SignalModel;
  bSuspended: boolean;
  _fireChange(params: { reason: string }): void;
};

/**
 * Casts to an internal type that includes UI5 runtime properties not exposed
 * by `@openui5/types` (e.g. `sPath`, `bSuspended`, `_fireChange`).
 */
function asInternal(self: SignalTreeBinding): TreeBindingInternal {
  return self as unknown as TreeBindingInternal;
}

/**
 * Tree binding that subscribes to a signal for push-based change notification.
 * Reuses ClientTreeBinding's filter/sort/tree traversal logic.
 *
 * @namespace ui5.model.signal
 */
export default class SignalTreeBinding extends ClientTreeBinding {
  watcher: Signal.subtle.Watcher | null = null;
  private _resubscribeCb: (() => void) | null = null;
  private _subscribedPath: string | null = null;

  checkUpdate(bForceUpdate?: boolean): void {
    const internal = asInternal(this);
    if (internal.bSuspended && !bForceUpdate) {
      return;
    }
    internal._fireChange({ reason: ChangeReason.Change });
  }

  subscribe(): void {
    this.unsubscribe();

    const resolvedPath = this.getResolvedPath();
    if (!resolvedPath) return;

    const internal = asInternal(this);
    const signal = internal.oModel.getSignal(resolvedPath);

    this.watcher = new Signal.subtle.Watcher(() => {
      scheduleFlush(this, signal);
    });
    this.watcher.watch(signal);

    this._subscribedPath = resolvedPath;
    this._resubscribeCb = () => this.subscribe();
    internal.oModel._onPathResubscribe(resolvedPath, this._resubscribeCb);
  }

  unsubscribe(): void {
    if (this._resubscribeCb && this._subscribedPath) {
      asInternal(this).oModel._offPathResubscribe(this._subscribedPath, this._resubscribeCb);
      this._resubscribeCb = null;
      this._subscribedPath = null;
    }
    cancelFlush(this);
    if (this.watcher) {
      const sources = Signal.subtle.introspectSources(this.watcher);
      if (sources.length) {
        this.watcher.unwatch(...sources);
      }
      this.watcher = null;
    }
  }

  override initialize(): this {
    if (!this.watcher) {
      this.subscribe();
    }
    // Fire initial change so controls (e.g. sap.m.Tree) populate their aggregation
    asInternal(this)._fireChange({ reason: ChangeReason.Change });
    return this;
  }

  setContext(oContext?: object): void {
    const internal = asInternal(this);
    if (internal.oContext !== oContext) {
      internal.oContext = oContext as Context;
      if (this.isRelative()) {
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
