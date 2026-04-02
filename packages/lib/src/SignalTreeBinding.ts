import ClientTreeBinding from "sap/ui/model/ClientTreeBinding";
import ChangeReason from "sap/ui/model/ChangeReason";
import Context from "sap/ui/model/Context";
import { Signal } from "signal-polyfill";
import type SignalModel from "./SignalModel";

// ClientTreeBinding internals not exposed by @openui5/types
type TreeBindingInternal = ClientTreeBinding & {
  sPath: string;
  oContext: Context | undefined;
  oModel: SignalModel;
  bSuspended: boolean;
  applyFilter(): void;
  _fireChange(params: { reason: string }): void;
  getResolvedPath(): string | undefined;
  isRelative(): boolean;
};

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
  private watcher: Signal.subtle.Watcher | null = null;
  private needsEnqueue = true;

  checkUpdate(bForceUpdate?: boolean): void {
    const internal = asInternal(this);
    if (internal.bSuspended && !bForceUpdate) {
      return;
    }
    internal._fireChange({ reason: ChangeReason.Change });
  }

  subscribe(): void {
    this.unsubscribe();

    const internal = asInternal(this);
    const resolvedPath = internal.getResolvedPath();
    if (!resolvedPath) return;

    const signal = internal.oModel._getOrCreateSignal(
      resolvedPath,
      internal.oModel._getObject(resolvedPath),
    );

    this.needsEnqueue = true;
    this.watcher = new Signal.subtle.Watcher(() => {
      if (this.needsEnqueue) {
        this.needsEnqueue = false;
        queueMicrotask(() => {
          this.needsEnqueue = true;
          signal.get();
          this.watcher?.watch();
          this.checkUpdate();
        });
      }
    });
    this.watcher.watch(signal);
  }

  unsubscribe(): void {
    if (this.watcher) {
      this.watcher.unwatch();
      this.watcher = null;
    }
  }

  override initialize(): this {
    this.subscribe();
    return this;
  }

  setContext(oContext?: object): void {
    const internal = asInternal(this);
    if (internal.oContext !== oContext) {
      internal.oContext = oContext as Context;
      if (internal.isRelative()) {
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
