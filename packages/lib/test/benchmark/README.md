# SignalModel vs JSONModel - Performance Benchmark

Self-contained benchmark comparing SignalModel and JSONModel across all binding types.

## Quick Start

```bash
npm run start:bench                                        # browser — opens benchmark page
npm run bench                                              # CLI — headless, streams to terminal
npm run bench -- --bindings 1000 --iterations 500 --rounds 10
npm run bench -- --bindings 2000 --json results.json       # save results as JSON
```

### Browser mode

`npm run start:bench` starts the dev server and opens the benchmark page. Select binding count, iterations, and rounds from the dropdowns, then click "Run Benchmark".

### CLI mode

`npm run bench` runs all scenarios in headless Chrome via WDIO and streams results to the terminal as each scenario completes. No browser window opens.

| Flag             | Default | Description                       |
| ---------------- | ------- | --------------------------------- |
| `--bindings N`   | `500`   | Number of UI5 property bindings   |
| `--iterations N` | `500`   | Iterations per scenario           |
| `--rounds N`     | `10`    | Measured rounds (alternating A-B) |
| `--json <file>`  | —       | Save results as JSON              |

The CLI reuses the same benchmark page and WDIO infrastructure as the QUnit tests — no additional dependencies. The benchmark HTML page accepts URL parameters (`?n=&iterations=&rounds=&autorun`) and exposes a `window.__bench` global that the WDIO spec polls for streaming results.

JSON output format:

```json
{
  "timestamp": "2026-04-03T...",
  "config": { "bindings": 1000, "iterations": 500, "rounds": 10 },
  "results": [
    {
      "name": "Update all 1000 bindings",
      "category": "Property (sap.m.Text)",
      "json": { "median": 204.6, "mean": 210.3, "stddev": 12.1, "min": 195.0, "max": 240.1, "p5": 196.2, "p95": 235.8 },
      "signal": { "median": 18.5, "mean": 19.1, "stddev": 1.8, "min": 16.2, "max": 23.4, "p5": 16.5, "p95": 22.9 }
    }
  ]
}

## What It Tests

17 scenarios across all binding types, model operations, and merge strategies:

| #   | Binding Type              | Scenario                                | What It Measures                                            |
| --- | ------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| 1   | Model API                 | setProperty throughput (no bindings)    | Raw per-call overhead of model layer                        |
| 2   | Model API                 | getProperty throughput                  | Read performance                                            |
| 3   | Property (`sap.m.Text`)   | Single-path update, N bindings          | O(1) vs O(N) notification, the key benchmark                |
| 4   | Property (`sap.m.Text`)   | Update all N bindings (sync)            | O(N) vs O(N^2) cumulative cost                              |
| 5   | Property (`sap.m.Text`)   | Update all N bindings (async)           | JSONModel `bAsyncUpdate=true` vs signals                    |
| 6   | List (`sap.m.List`)       | List binding replace                    | Array replacement with `StandardListItem` template          |
| 7   | List (`sap.m.Table`)      | Table binding replace                   | Row replacement with 3 `ColumnListItem` cells               |
| 8   | Tree (`sap.m.Tree`)       | Tree binding replace                    | Hierarchical data replacement with `StandardTreeItem`       |
| 9   | Expression (`sap.m.Text`) | Expression binding                      | Composite `{= ${/path1} + ${/path2}}` re-evaluation         |
| 10  | Computed (`sap.m.Text`)   | Computed signals                        | `createComputed` dependency chain propagation               |
| 11  | Computed (`sap.m.Text`)   | Computed (redefined)                    | `removeComputed` + `createComputed` re-subscribe cost       |
| 12  | Property (`sap.m.Text`)   | setData replace                         | Full data replacement propagation                           |
| 13  | Property (`sap.m.Text`)   | setData merge (shallow)                 | Merge 5 items into N, small payload into large data         |
| 14  | Property (`sap.m.Text`)   | setData merge (deep)                    | Merge all N items, full payload, worst case for merge       |
| 15  | Property (`sap.m.Text`)   | setData merge (nested config)           | Merge 3 deep leaf paths into a 5-level config tree          |
| 16  | Property (`sap.m.Text`)   | setData merge (large dataset, pinpoint) | Merge 3 items into 10x N, tests O(k) vs O(n) merge          |
| 17  | Property (`sap.m.Text`)   | Real-world: checkPerformanceOfUpdate    | 3,449 bindings, 29 sync calls, exceeds SAP's 100k threshold |

### Merge Scenario Design

The merge scenarios (13-16) test different payload shapes that exercise the `setData(data, true)` code path with varying data-to-payload ratios:

- **Shallow (13)**: Small flat payload into a large flat array. Both models pay the `deepExtend`/in-place merge cost, but binding notification cost dominates because all N bindings exist. Tests the common "update a few fields in a form" pattern.
- **Deep (14)**: Payload covers every item. Worst case for merge: no savings from targeted invalidation. Both models must process all N items.
- **Nested config (15)**: Realistic deeply nested configuration object (5 levels: `app.features.notifications.push`). The merge payload touches only 3 leaf paths. Tests recursive merge depth traversal.
- **Large dataset, pinpoint (16)**: The key merge benchmark. Creates 10x N items (e.g., 10,000 for N=1000) with complex objects (7 properties, nested `metadata`), then merges only 3 items. JSONModel's `deepExtend` must deep-clone all 10,000 objects. SignalModel's in-place merge walks only the 3 payload items. Isolates the O(n) vs O(k) architectural difference.

## How It Works

### Bootstrap

The page loads UI5 via the standard bootstrap script served by `ui5 serve`. `ui5-tooling-transpile-middleware` transpiles TypeScript on-the-fly and `ui5-tooling-modules-middleware` resolves npm dependencies (`signal-polyfill`) into UI5-compatible modules.

### Module Loading

When "Run Benchmark" is clicked, `sap.ui.require` loads:

- `sap/ui/model/json/JSONModel` (from the OpenUI5 framework)
- `ui5/model/signal/SignalModel` (from the library, transpiled from TypeScript)
- Control classes: `sap/m/Text`, `sap/m/List`, `sap/m/Table`, `sap/m/Tree`, and their list items

### Execution

Each scenario:

1. Creates a fresh model with deep-copied data (`JSON.parse(JSON.stringify(...))`)
2. Creates real UI5 controls with declarative bindings, placed in a hidden `display:none` container
3. Runs 3 warmup rounds to stabilize JIT compilation
4. Takes 1 timed measurement including full async propagation
5. Destroys all controls and the model

The `runAlternating` function interleaves JSON and Signal runs (JSON-Signal, Signal-JSON, JSON-Signal...) across all samples to cancel out GC pauses, thermal throttling, and JIT compilation bias.

### Flush Protocol

After each timed operation, a three-stage async drain ensures all notifications complete:

1. `Promise.resolve().then(...)` - drains microtask queue (SignalModel's `queueMicrotask` callbacks)
2. `setTimeout(resolve, 0)` - yields to macrotask queue (JSONModel's async `checkUpdate`)
3. `queueMicrotask(resolve)` - final microtask drain for any cascaded notifications

### Statistics

Uses Bessel-corrected (sample) variance. Reports: median, mean, standard deviation, min, max, P5, P95. Median is the primary metric as it is robust to GC-caused outliers.

> [!NOTE]
> Results vary by hardware, browser engine, and system load. The numbers below are from a single reference run. Run the benchmarks on your own setup for representative numbers.

## Results (2000 bindings, 500 iterations, 10 rounds)

### Full results at 2000 bindings

| Binding Type            | Scenario                             | JSONModel | SignalModel | Comparison        |
| ----------------------- | ------------------------------------ | --------- | ----------- | ----------------- |
| Model API               | setProperty (no bindings)            | 0.10ms    | 0.20ms      | ~equal            |
| Model API               | getProperty                          | 0.00ms    | 0.20ms      | ~equal            |
| Property (sap.m.Text)   | Single-path update, 2000 bindings    | 5.10ms    | 4.50ms      | ~equal            |
| Property (sap.m.Text)   | Update all 2000 (sync)               | 806.60ms  | 52.20ms     | **15.45x faster** |
| Property (sap.m.Text)   | Update all 2000 (async)              | 20.80ms   | 18.30ms     | ~equal            |
| List (sap.m.List)       | List binding replace, 500 items      | 8.10ms    | 9.00ms      | ~equal            |
| List (sap.m.Table)      | Table binding replace, 500 rows      | 7.40ms    | 8.30ms      | 1.12x slower      |
| Tree (sap.m.Tree)       | Tree binding replace, 200 nodes      | 10.70ms   | 10.00ms     | ~equal            |
| Expression (sap.m.Text) | Expression binding, 500 controls     | 5.50ms    | 5.00ms      | ~equal            |
| Computed (sap.m.Text)   | Computed signals, 500 computeds      | 4.60ms    | 5.20ms      | ~equal            |
| Computed (sap.m.Text)   | Computed (redefined), 500 computeds  | 5.40ms    | 5.80ms      | ~equal            |
| Property (sap.m.Text)   | setData replace, 2000 bindings       | 23.60ms   | 24.50ms     | ~equal            |
| Property (sap.m.Text)   | setData merge (shallow), 5 into 2k   | 5.70ms    | 5.00ms      | ~equal            |
| Property (sap.m.Text)   | setData merge (deep), all 2k         | 24.00ms   | 23.90ms     | ~equal            |
| Property (sap.m.Text)   | setData merge (nested config)        | 7.00ms    | 4.50ms      | **1.56x faster**  |
| Property (sap.m.Text)   | setData merge (large, pinpoint) 20k  | 21.00ms   | 5.00ms      | **4.20x faster**  |
| Property (sap.m.Text)   | Real-world: checkPerformanceOfUpdate | 27.40ms   | 7.00ms      | **3.91x faster**  |

### Honest Observations

**Where SignalModel is faster:**

"Update all N bindings (sync)" shows the largest difference: at 2000 bindings, JSONModel takes ~807ms vs SignalModel's ~52ms (**~15x faster**). JSONModel's default synchronous `setProperty` calls `checkUpdate` after every call, iterating all bindings each time: O(N²) total (2000 calls × 2000 bindings = 4,000,000 binding checks). SignalModel is O(N) total (2000 notifications, one per changed path).

**The `bAsyncUpdate` path:**

JSONModel's `setProperty` accepts a `bAsyncUpdate` parameter. When `true`, it batches all `checkUpdate` calls into a single `setTimeout` pass, collapsing O(N²) to O(N). SignalModel now matches this: when `bAsyncUpdate=true`, signal notifications are deferred and synced in a single `setTimeout` pass. Both models perform equivalently in this scenario.

> [!NOTE]
> **How we got here — the async scenario investigation**
>
> SignalModel originally showed **2.5x slower** performance in this scenario (~52ms vs ~21ms at 2000 bindings). We investigated the root cause through several steps:
>
> 1. **Watcher re-arm cycle.** The TC39 `Signal.subtle.Watcher` requires an explicit re-arm (`signal.get()` + `watcher.watch()`) after each notification. We initially attributed the gap to this per-binding overhead. Other frameworks (Preact, Solid, Vue) avoid it via persistent subscriptions.
>
> 2. **Polyfill swap.** Tested [alien-signals](https://github.com/stackblitz/alien-signals) (a high-performance reactive engine, being considered as the new `signal-polyfill` base in [PR #44](https://github.com/proposal-signals/signal-polyfill/pull/44)). Result: identical performance across all 17 scenarios. The polyfill engine was not the bottleneck.
>
> 3. **Flush loop instrumentation.** Measured per-step cost at 2000 bindings: `signal.get()` = 9%, `watcher.watch()` = 12%, `checkUpdate()` = 79%. The re-arm cycle was only ~21% of the flush — UI5's binding refresh dominated.
>
> 4. **Root cause found.** The real cost was not in the flush but in the `setProperty` loop itself. Each of the 2000 `setProperty` calls fired a synchronous Watcher `notify` callback — even though `bAsyncUpdate=true` was meant to defer work. JSONModel's async path skips all notification during the loop and syncs once afterward.
>
> 5. **Fix.** When `bAsyncUpdate=true`, SignalModel now writes data immediately but skips signal notification entirely. A single `setTimeout` calls `registry.invalidateAll()` to sync all signals at once. This matches JSONModel's batching strategy: zero notification cost during the write loop, one batched pass afterward. Result: **~equal** performance.

**In-place merge:**

The "large dataset, pinpoint merge" scenario (3 items into 20,000) shows **4.20x faster** performance. JSONModel's `deepExtend` deep-clones the entire 20,000-item array (each item has 7 properties including nested `metadata`) to overlay 3 items. SignalModel's `_mergeInPlace` walks only the 3 payload keys in-place: O(k) instead of O(n). The advantage grows linearly with the data-to-payload ratio. Fiori apps with large OData entity sets and form-level edits (e.g., editing 3 fields in a 5,000-row table) would see similar improvements.

Nested config merge shows **1.56x faster**, where the O(n) clone cost of `deepExtend` becomes visible against targeted in-place updates.

**checkPerformanceOfUpdate threshold:**

Scenario 17 reproduces the conditions from SAP's `checkPerformanceOfUpdate` warning: 3,449 bindings with 29 consecutive synchronous `setProperty` calls (100,021 cumulative binding checks, exceeding SAP's 100k threshold). JSONModel takes ~27ms vs SignalModel's ~7ms (**3.91x faster**). This is the scale where SAP added a runtime performance warning.

**Computed redefinition has zero overhead:**

"Computed (redefined)" redefines all 500 computeds via `removeComputed` + `createComputed` with different dependencies, then measures update propagation. Performance is equivalent to regular computed signals. The re-subscribe bridge adds no measurable cost.

**Where both models are equivalent:**

For list, table, and tree binding scenarios where the entire aggregation is replaced, both models perform equivalently. DOM rendering cost (destroying and recreating list items, table rows, tree nodes) dominates the model notification cost. The model layer is not the bottleneck.

Expression binding, computed signals, getProperty, setProperty (no bindings), setData replace, and equal-sized merges are all equivalent.

**What SignalModel offers over JSONModel with `bAsyncUpdate`:**

1. **Correct by default.** Developers do not need to remember to pass `bAsyncUpdate=true`. SAP added `checkPerformanceOfUpdate` specifically because developers keep using the synchronous default. SignalModel is always O(1) per notification regardless of how `setProperty` is called.

2. **Per-path notification.** Even with `bAsyncUpdate=true`, JSONModel's single `checkUpdate` pass still iterates ALL bindings and runs `deepEqual` on each. With 3,000+ bindings (the scale reported in [openui5 issue 2600](https://github.com/UI5/openui5/issues/2600)), this single pass alone takes ~200ms. SignalModel notifies only the bindings on changed paths.

3. **Computed signals.** Model-layer derived values (`createComputed`) that update reactively. JSONModel has no equivalent; formatters are view-layer and do not participate in the model's dependency graph.

4. **In-place merge.** `setData(partial, true)` uses an O(k) in-place recursive merge instead of O(n) `deepExtend` clone. For large datasets with small merge payloads, measurably faster (4.2x at 20k items, scaling linearly with data size).

5. **TC39 Signals alignment.** When the [TC39 Signals proposal](https://github.com/tc39/proposal-signals) ships natively in browsers, `signal-polyfill` can be swapped for the native implementation with zero API changes.

## Reference Screenshots

Full-page screenshots for each binding count:

- [100 bindings](../../../../docs/img/benchmark-100-bindings.png)
- [500 bindings](../../../../docs/img/benchmark-500-bindings.png)
- [1000 bindings](../../../../docs/img/benchmark-1000-bindings.png)
- [2000 bindings](../../../../docs/img/benchmark-2000-bindings.png)

## Background

- [openui5 issue 2600](https://github.com/UI5/openui5/issues/2600) - documents the `checkUpdate` O(N) bottleneck
- [openui5 issue 4351](https://github.com/UI5/openui5/issues/4351) - related DOM accumulation problem in large apps
- SAP commit `cb6c7f7a` - added `checkPerformanceOfUpdate` warning at 100,000 cumulative binding checks
```
