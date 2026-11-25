import Log from "sap/base/Log";
import { Signal } from "signal-polyfill";

/**
 * Interface for bindings that participate in microtask-batched flush.
 */
export interface FlushableBinding {
  watcher: Signal.subtle.Watcher | null;
  checkUpdate(forceUpdate?: boolean): void;
  _checkUpdateFromSignal?(value: unknown): void;
}

/**
 * Shared microtask batching queue for all signal-based bindings.
 *
 * Collects pending binding updates and processes them in a single microtask
 * instead of scheduling one microtask per signal change. Multiple signal
 * notifications within the same synchronous block are collapsed into a
 * single checkUpdate per binding.
 *
 * Uses queueMicrotask (not setTimeout) deliberately: microtasks run before
 * the browser paints, so the first rendered frame always shows correct data.
 * JSONModel's bAsyncUpdate uses setTimeout, which can flash one stale frame
 * before the checkUpdate pass runs. See "Microtask vs Macrotask
 * Scheduling" in docs/architecture.md for the full rationale.
 */
let pendingUpdates = new Map<FlushableBinding, Signal.State<unknown> | Signal.Computed<unknown>>();
let flushScheduled = false;
/** The batch being processed, so that cancelFlush() also reaches bindings queued in it. */
let flushing: typeof pendingUpdates | null = null;

/**
 * Enqueue a binding for batched update in the next microtask.
 *
 * @param binding - The binding to schedule for update.
 * @param signal - The signal that triggered the change.
 * @since 0.1.0
 */
export function scheduleFlush(
  binding: FlushableBinding,
  signal: Signal.State<unknown> | Signal.Computed<unknown>,
): void {
  pendingUpdates.set(binding, signal);
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      // Swap the map so new notifications during checkUpdate() are
      // queued for the next flush cycle, not processed in this one.
      const batch = pendingUpdates;
      pendingUpdates = new Map();
      flushing = batch;
      // A binding destroyed or re-subscribed by an earlier update of this batch has been
      // removed from it by cancelFlush(): its queued signal is no longer the one it shows.
      for (const [b, s] of batch) {
        let value: unknown;
        let readFailed = false;
        try {
          value = s.get();
        } catch (e) {
          readFailed = true;
          Log.error(
            "SignalModel: signal read failed during flush",
            e as Error,
            "ui5.model.signal.FlushQueue",
          );
        }
        // Always re-arm watcher before checkUpdate (and even if s.get() threw)
        // so the binding can recover on subsequent dependency changes.
        b.watcher?.watch();
        if (readFailed) continue;
        try {
          if (b._checkUpdateFromSignal) {
            b._checkUpdateFromSignal(value);
          } else {
            b.checkUpdate();
          }
        } catch (e) {
          Log.error(
            "SignalModel: checkUpdate failed for binding",
            e as Error,
            "ui5.model.signal.FlushQueue",
          );
        }
      }
      flushing = null;
    });
  }
}

/**
 * Remove a binding from the pending flush queue.
 *
 * @param binding - The binding to dequeue.
 * @since 0.1.0
 */
export function cancelFlush(binding: FlushableBinding): void {
  pendingUpdates.delete(binding);
  flushing?.delete(binding);
}

/**
 * Unwatch all sources on a watcher and return null for assignment.
 * Shared across all binding classes to avoid duplicating the teardown sequence.
 *
 * @param watcher - The watcher to tear down, or null.
 * @returns null for direct assignment to the watcher field.
 * @since 0.1.0
 */
export function teardownWatcher(watcher: Signal.subtle.Watcher | null): null {
  if (watcher) {
    const sources = Signal.subtle.introspectSources(watcher);
    if (sources.length) {
      watcher.unwatch(...sources);
    }
  }
  return null;
}
