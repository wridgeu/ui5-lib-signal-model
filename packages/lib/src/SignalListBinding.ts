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

// Microtask batching for list bindings
let pendingQueue: Array<SignalListBinding> = [];
let flushScheduled = false;

function scheduleFlush(): void {
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      const queue = pendingQueue;
      pendingQueue = [];
      for (let i = 0; i < queue.length; i++) {
        const binding = queue[i];
        binding.pending = false;
        const s = binding.trackedSignal;
        if (s) {
          s.get();
          binding.watcher?.watch();
        }
        binding.checkUpdate();
      }
    });
  }
}

/**
 * List binding that subscribes to a signal for push-based change notification.
 * Reuses ClientListBinding's filter/sort/extended-change-detection.
 *
 * @namespace ui5.model.signal
 */
export default class SignalListBinding extends ClientListBinding {
  watcher: Signal.subtle.Watcher | null = null;
  trackedSignal: Signal.State<unknown> | Signal.Computed<unknown> | null = null;
  pending = false;

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

    this.trackedSignal = signal;
    this.watcher = new Signal.subtle.Watcher(() => {
      if (!this.pending) {
        this.pending = true;
        pendingQueue.push(this);
        scheduleFlush();
      }
    });
    this.watcher.watch(signal);
  }

  unsubscribe(): void {
    this.pending = false;
    this.trackedSignal = null;
    if (this.watcher) {
      const sources = Signal.subtle.introspectSources(this.watcher);
      if (sources.length) {
        this.watcher.unwatch(...sources);
      }
      this.watcher = null;
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
