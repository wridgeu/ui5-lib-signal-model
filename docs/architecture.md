# Architecture

Implementation-level details of SignalModel's reactive architecture. For usage documentation, see the [library README](../packages/lib/README.md).

## Overview

```
XML View bindings: {/customer/name}, {/orders}, {path: '/tree', ...}
        |
        | bindProperty / bindList / bindTree
        v
SignalPropertyBinding / SignalListBinding / SignalTreeBinding
  - Each subscribes to its path's signal via Signal.subtle.Watcher
  - Push-based: queueMicrotask batching, no polling
        |
        | reads / subscribes
        v
Signal Registry (two Maps: State signals + Computed signals)
  - Signals created lazily on first access (bind, getSignal, or createComputed dependency)
  - Custom equality: primitives use Object.is, objects always notify
  - Computed signals take precedence over state signals at the same path
        |
        | setProperty / setData / mergeProperty
        v
SignalModel (extends ClientModel)
  - this.oData = raw JS object (source of truth)
  - setProperty -> update oData + set signal + invalidate parents
  - setData replace -> update oData + invalidate all signals
  - setData merge -> update oData + invalidate only merge payload paths
  - mergeProperty -> deep merge + recursive change detection
```

## Unified Microtask Flush Queue

Each binding type (property, list, tree) subscribes to its path's signal via `Signal.subtle.Watcher`. When a signal changes, the Watcher callback fires synchronously, but `checkUpdate()` is not called immediately. All bindings share a single flush queue (`FlushQueue.ts`) that batches updates into one `queueMicrotask`:

- **One microtask per synchronous block**, regardless of how many bindings or binding types are notified.
- **Map-based deduplication**: `Map<binding, signal>` ensures each binding appears at most once. Rapid-fire `setProperty` calls (e.g., updating 10 fields in a loop) produce exactly one `checkUpdate` per affected binding.
- **Watcher re-arm protocol**: The TC39 Watcher fires at most once between `watch()` calls. The flush reads the current value (`signal.get()`, consuming the notification), re-arms the watcher (`watcher.watch()`, listening for the next change), then fires the UI change (`checkUpdate()`).

When `bAsyncUpdate=true` is passed to `setProperty`, this entire path is bypassed. Data is written immediately without signal notification, and a single `setTimeout` syncs all signals afterward via `registry.invalidateAll()`. See [Batching and `bAsyncUpdate`](#batching-and-basyncupdate).

## In-Place Merge (Eliminating `deepExtend`)

UI5's `JSONModel.setData(data, true)` uses `sap/base/util/deepExtend` to deep-clone the entire model data and then overlay the merge payload. For a model with 1000 items where you merge 5, this clones all 1000, doing O(n) work for an O(k) operation.

SignalModel replaces this with an **in-place recursive merge** (`_mergeInPlace`) that:

1. Walks only the merge payload keys (not the entire data tree)
2. Compares old vs new values inline (no separate invalidation pass)
3. Overwrites changed values directly in `this.oData`
4. Fires signals for changed paths as it goes
5. Uses `structuredClone()` for incoming object/array values to prevent external mutation

This reduces `setData(partial, true)` from O(n) to O(k) where k is the payload size. The improvement is largest for shallow merges into large datasets, common in form-based Fiori apps that update a few fields at a time.

## `structuredClone` over `deepExtend` for Deep Copies

Where a pure deep clone is needed (not a merge), `structuredClone()` replaces `deepExtend({}, source)`. This applies to `SignalListBinding.update()`, which copies list data for UI5's extended change detection. `structuredClone` is implemented natively in C++ by the browser engine and avoids the overhead of UI5's JavaScript-based recursive clone.

## Batching and `bAsyncUpdate`

JSONModel's `setProperty` accepts a `bAsyncUpdate` flag that defers `checkUpdate` into a `setTimeout`, collapsing N synchronous `setProperty` calls into a single binding check pass. This is SAP's recommended workaround for the O(N²) problem documented in [openui5 issue 2600](https://github.com/UI5/openui5/issues/2600).

SignalModel supports this flag. When `bAsyncUpdate=true`, signal notifications are deferred -- the data is written immediately but signal updates are batched into a single `setTimeout` pass that syncs all signals afterward. Both models perform equivalently in this scenario (~18ms each at 2000 bindings). Without the flag (default), SignalModel uses its push-based microtask flush which provides O(1) per-path notification.

## Microtask vs Macrotask Scheduling

SignalModel has two scheduling paths depending on how `setProperty` is called:

- **Default (no `bAsyncUpdate`):** signal changes fire synchronously, and the FlushQueue batches binding updates via `queueMicrotask`. Microtasks run before the browser paints, so the first frame always shows correct data. One paint, always consistent.
- **`bAsyncUpdate=true`:** signal notifications are skipped entirely during the `setProperty` loop. A single `setTimeout` syncs all signals afterward. This uses the same macrotask scheduling as JSONModel's `bAsyncUpdate` -- the browser may render one stale frame before bindings update.

The browser event loop processes work in this order: **current JS > all microtasks > render (paint) > next macrotask**.

The default path gives SignalModel a visual consistency advantage over JSONModel's `bAsyncUpdate`: no stale frames. When `bAsyncUpdate=true` is explicitly requested, SignalModel matches JSONModel's `setTimeout`-based batching -- same scheduling, same visual behavior, same performance.
