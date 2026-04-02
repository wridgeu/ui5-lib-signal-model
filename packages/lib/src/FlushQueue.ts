import Log from "sap/base/Log";
import { Signal } from "signal-polyfill";

/**
 * Interface for bindings that participate in microtask-batched flush.
 */
interface FlushableBinding {
  watcher: Signal.subtle.Watcher | null;
  checkUpdate(bForceUpdate?: boolean): void;
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
 * before the checkUpdate pass runs. See README "Microtask vs Macrotask
 * Scheduling" for the full rationale.
 */
const pendingUpdates = new Map<
  FlushableBinding,
  Signal.State<unknown> | Signal.Computed<unknown>
>();
let flushScheduled = false;

export function scheduleFlush(
  binding: FlushableBinding,
  signal: Signal.State<unknown> | Signal.Computed<unknown>,
): void {
  pendingUpdates.set(binding, signal);
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      const entries = [...pendingUpdates.entries()];
      pendingUpdates.clear();
      for (const [b, s] of entries) {
        s.get();
        b.watcher?.watch();
        try {
          b.checkUpdate();
        } catch (e) {
          Log.error(
            "SignalModel: checkUpdate failed for binding",
            e instanceof Error ? e : String(e),
            "ui5.model.signal.FlushQueue",
          );
        }
      }
    });
  }
}

export function cancelFlush(binding: FlushableBinding): void {
  pendingUpdates.delete(binding);
}
