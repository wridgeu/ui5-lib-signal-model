import ClientPropertyBinding from "sap/ui/model/ClientPropertyBinding";
import ChangeReason from "sap/ui/model/ChangeReason";
import { Signal } from "signal-polyfill";
import type SignalModel from "./SignalModel";

/**
 * Property binding that subscribes to a signal for push-based change notification.
 *
 * @namespace ui5.model.signal
 */
export default class SignalPropertyBinding extends ClientPropertyBinding {
  declare oModel: SignalModel;
  private watcher: Signal.subtle.Watcher | null = null;
  private needsEnqueue = true;

  override checkUpdate(bForceUpdate?: boolean): void {
    if (this.bSuspended && !bForceUpdate) {
      return;
    }

    const oValue = this._getValue();
    if (this.oValue !== oValue || bForceUpdate) {
      this.oValue = oValue;
      this.getDataState().setValue(this.oValue);
      this.checkDataState();
      this._fireChange({ reason: ChangeReason.Change });
    }
  }

  override setValue(oValue: unknown): void {
    if (this.bSuspended) {
      return;
    }

    if (this.oValue !== oValue) {
      this.oModel.setProperty(this.sPath, oValue, this.oContext, true);
      this.oValue = oValue;
      this.getDataState().setValue(this.oValue);
      this.oModel.firePropertyChange({
        reason: ChangeReason.Binding,
        path: this.sPath,
        context: this.oContext,
        value: oValue,
      });
    }
  }

  subscribe(): void {
    this.unsubscribe();

    const resolvedPath = this.getResolvedPath();
    if (!resolvedPath) return;

    const signal = this.oModel._getOrCreateSignal(resolvedPath, this._getValue());

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
    this.checkUpdate(true);
    return this;
  }

  override setContext(oContext?: object): void {
    if (this.oContext !== oContext) {
      const oldResolved = this.getResolvedPath();
      super.setContext(oContext);
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
