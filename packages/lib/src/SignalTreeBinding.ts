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

// Microtask batching for tree bindings
let pendingQueue: Array<SignalTreeBinding> = [];
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
 * Tree binding that subscribes to a signal for push-based change notification.
 * Reuses ClientTreeBinding's filter/sort/tree traversal logic.
 *
 * @namespace ui5.model.signal
 */
export default class SignalTreeBinding extends ClientTreeBinding {
  watcher: Signal.subtle.Watcher | null = null;
  trackedSignal: Signal.State<unknown> | Signal.Computed<unknown> | null = null;
  pending = false;

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
