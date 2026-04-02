import ClientListBinding from "sap/ui/model/ClientListBinding";
import ChangeReason from "sap/ui/model/ChangeReason";
import Context from "sap/ui/model/Context";
import deepExtend from "sap/base/util/deepExtend";
import { Signal } from "signal-polyfill";
import type SignalModel from "./SignalModel";

// ClientListBinding internals not exposed by @openui5/types
type ListBindingInternal = ClientListBinding & {
  oList: unknown[] | Record<string, unknown>;
  aIndices: number[];
  iLength: number;
  bUseExtendedChangeDetection: boolean;
  sPath: string;
  oContext: Context | undefined;
  bSuspended: boolean;
  oModel: SignalModel;
  updateIndices(): void;
  applyFilter(): void;
  applySort(): void;
  _getLength(): number;
  _fireChange(params: { reason: string }): void;
  getResolvedPath(): string | undefined;
  isRelative(): boolean;
};

function asInternal(self: SignalListBinding): ListBindingInternal {
  return self as unknown as ListBindingInternal;
}

// Shared watcher for all list bindings
type AnySignal = Signal.State<unknown> | Signal.Computed<unknown>;
const signalToBindings = new Map<AnySignal, Set<SignalListBinding>>();
let flushScheduled = false;

const sharedWatcher = new Signal.subtle.Watcher(() => {
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flush);
  }
});

function flush(): void {
  flushScheduled = false;
  const pending = sharedWatcher.getPending();
  for (const s of pending) {
    s.get();
  }
  sharedWatcher.watch();
  for (const s of pending) {
    const bindings = signalToBindings.get(s as AnySignal);
    if (bindings) {
      for (const binding of bindings) {
        binding.checkUpdate();
      }
    }
  }
}

/**
 * List binding that subscribes to a signal for push-based change notification.
 * Reuses ClientListBinding's filter/sort/extended-change-detection.
 *
 * @namespace ui5.model.signal
 */
export default class SignalListBinding extends ClientListBinding {
  private watchedSignal: AnySignal | null = null;

  update(): void {
    const internal = asInternal(this);
    const oList = internal.oModel._getObject(internal.sPath, internal.oContext);
    if (oList) {
      if (Array.isArray(oList)) {
        internal.oList = internal.bUseExtendedChangeDetection
          ? (deepExtend([], oList) as unknown[])
          : oList.slice();
      } else {
        internal.oList = internal.bUseExtendedChangeDetection
          ? (deepExtend({}, oList) as Record<string, unknown>)
          : Object.assign({}, oList);
      }
      internal.updateIndices();
      internal.applyFilter();
      internal.applySort();
      internal.iLength = internal._getLength();
    } else {
      internal.oList = [];
      internal.aIndices = [];
      internal.iLength = 0;
    }
  }

  checkUpdate(bForceUpdate?: boolean): void {
    const internal = asInternal(this);
    if (internal.bSuspended && !bForceUpdate) {
      return;
    }
    this.update();
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
    this.watchedSignal = signal;

    let bindings = signalToBindings.get(signal);
    if (!bindings) {
      bindings = new Set();
      signalToBindings.set(signal, bindings);
    }
    bindings.add(this);

    sharedWatcher.watch(signal);
  }

  unsubscribe(): void {
    if (this.watchedSignal) {
      const bindings = signalToBindings.get(this.watchedSignal);
      if (bindings) {
        bindings.delete(this);
        if (bindings.size === 0) {
          signalToBindings.delete(this.watchedSignal);
          sharedWatcher.unwatch(this.watchedSignal);
        }
      }
      this.watchedSignal = null;
    }
  }

  override initialize(): this {
    this.update();
    this.subscribe();
    return this;
  }

  setContext(oContext?: object): void {
    const internal = asInternal(this);
    if (internal.oContext !== oContext) {
      internal.oContext = oContext as Context;
      if (internal.isRelative()) {
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
