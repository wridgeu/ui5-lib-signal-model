# SignalModel vs JSONModel - Performance Benchmark

Self-contained benchmark comparing SignalModel and JSONModel across all binding types.

## Quick Start

```bash
npm run start:bench                                        # browser -- opens benchmark page
npm run bench                                              # CLI -- headless, streams to terminal
npm run bench -- --bindings 1000 --iterations 500 --rounds 10
npm run bench -- --bindings 2000 --json results.json       # save results as JSON
npm run bench:stable                                       # CLI -- multi-run stability analysis
```

### Multi-run stability analysis

`npm run bench:stable` runs the CLI benchmark multiple times and produces a merged table showing all runs side-by-side with per-scenario stability verdicts. This distinguishes stable performance wins from measurement noise.

```bash
npm run bench:stable                                       # 4 runs at 2000 bindings (defaults)
npm run bench:stable -- --runs 6 --bindings 1000
npm run bench:stable -- --runs 4 --json stability.json     # save merged results as JSON
```

| Flag             | Default | Description                     |
| ---------------- | ------- | ------------------------------- |
| `--runs N`       | `4`     | Number of benchmark runs        |
| `--bindings N`   | `2000`  | Number of UI5 property bindings |
| `--iterations N` | `500`   | Iterations per scenario         |
| `--rounds N`     | `20`    | Measured rounds per run         |
| `--json <file>`  | --      | Save merged results as JSON     |

**Verdict logic:**

- Each run is classified as `faster`, `slower`, or `~equal` using the same significance checks as the single-run CLI
- `~equal` is neutral -- ignored when determining consistency
- If all non-equal runs agree (or all are `~equal`): **stable**
- If both `faster` and `slower` appear: **noise**

### Browser mode

`npm run start:bench` starts the dev server and opens the benchmark page. Select binding count, iterations, and rounds from the dropdowns, then click "Run Benchmark".

### CLI mode

`npm run bench` runs all scenarios in headless Chrome via WDIO and streams results to the terminal as each scenario completes. No browser window opens.

| Flag             | Default | Description                       |
| ---------------- | ------- | --------------------------------- |
| `--bindings N`   | `500`   | Number of UI5 property bindings   |
| `--iterations N` | `500`   | Iterations per scenario           |
| `--rounds N`     | `20`    | Measured rounds (alternating A-B) |
| `--json <file>`  | --      | Save results as JSON              |

The CLI reuses the same benchmark page and WDIO infrastructure as the QUnit tests -- no additional dependencies. The benchmark HTML page accepts URL parameters (`?n=&iterations=&rounds=&autorun`) and exposes a `window.__bench` global that the WDIO spec polls for streaming results.

JSON output format:

```json
{
  "timestamp": "2026-04-03T...",
  "config": { "bindings": 1000, "iterations": 500, "rounds": 10 },
  "results": [
    {
      "name": "Update all 1000 bindings",
      "category": "Property (sap.m.Text)",
      "json": {
        "median": 204.6,
        "mean": 210.3,
        "stddev": 12.1,
        "min": 195.0,
        "max": 240.1,
        "p5": 196.2,
        "p95": 235.8
      },
      "signal": {
        "median": 18.5,
        "mean": 19.1,
        "stddev": 1.8,
        "min": 16.2,
        "max": 23.4,
        "p5": 16.5,
        "p95": 22.9
      }
    }
  ]
}
```

## What It Tests

22 scenarios across all binding types, model operations, and merge strategies:

| #   | Binding Type                | Scenario                                | What It Measures                                                |
| --- | --------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| 1   | Model API                   | setProperty throughput (no bindings)    | Raw per-call overhead of model layer                            |
| 2   | Model API                   | getProperty throughput                  | Read performance                                                |
| 3   | Property (`sap.m.Text`)     | Single-path update, N bindings          | O(1) vs O(N) notification, the key benchmark                    |
| 4   | Property (`sap.m.Text`)     | Update all N bindings (sync)            | O(N) vs O(N^2) cumulative cost                                  |
| 5   | Property (`sap.m.Text`)     | Update all N bindings (async)           | JSONModel `bAsyncUpdate=true` vs signals                        |
| 6   | Property (`sap.m.Text`)     | Sparse async, 1 of N (async)            | Single path change with N bindings, async mode                  |
| 7   | List (`sap.m.List`)         | List binding replace                    | Array replacement with `StandardListItem` template              |
| 8   | List (`sap.m.Table`)        | Table binding replace                   | Row replacement with 3 `ColumnListItem` cells                   |
| 9   | List (`sap.ui.table.Table`) | Grid table binding replace              | Virtualized row replacement, 3 columns, no row cap              |
| 10  | Tree (`sap.m.Tree`)         | Tree binding replace                    | Hierarchical data replacement with `StandardTreeItem`           |
| 11  | Expression (`sap.m.Text`)   | Expression binding                      | Composite `{= ${/path1} + ${/path2}}` re-evaluation             |
| 12  | Computed (`sap.m.Text`)     | Computed signals                        | `createComputed` dependency chain propagation                   |
| 13  | Computed (`sap.m.Text`)     | Computed (redefined)                    | `removeComputed` + `createComputed` re-subscribe cost           |
| 14  | Computed (`sap.m.Text`)     | Computed sub-path                       | Binding to sub-path of computed object, `_getObject` traversal  |
| 15  | Computed (`sap.m.Text`)     | Computed redefine + sub-path            | `_firePathResubscribe` prefix scan with sub-path bindings       |
| 16  | Property (`sap.m.Text`)     | setData replace                         | Full data replacement propagation                               |
| 17  | Property (`sap.m.Text`)     | setData merge (shallow)                 | Merge 5 items into N, small payload into large data             |
| 18  | Property (`sap.m.Text`)     | setData merge (deep)                    | Merge all N items, full payload, worst case for merge           |
| 19  | Property (`sap.m.Text`)     | setData merge (nested config)           | Merge 3 deep leaf paths into a 5-level config tree              |
| 20  | Property (`sap.m.Text`)     | setData merge (large dataset, pinpoint) | Merge 3 items into 10x N, tests O(k) vs O(n) merge              |
| 21  | Property (`sap.m.Text`)     | Real-world: checkPerformanceOfUpdate    | 3,449 bindings, 29 sync calls, exceeds SAP's 100k threshold     |
| 22  | Property (`sap.m.Text`)     | Deep-path setProperty (no computeds)    | 4-segment path `_findComputedAncestor` overhead, zero computeds |

### Merge Scenario Design

The merge scenarios (17-20) test different payload shapes that exercise the `setData(data, true)` code path with varying data-to-payload ratios:

- **Shallow (17)**: Small flat payload into a large flat array. Both models pay the `deepExtend`/in-place merge cost, but binding notification cost dominates because all N bindings exist. Tests the common "update a few fields in a form" pattern.
- **Deep (18)**: Payload covers every item. Worst case for merge: no savings from targeted invalidation. Both models must process all N items.
- **Nested config (19)**: Realistic deeply nested configuration object (5 levels: `app.features.notifications.push`). The merge payload touches only 3 leaf paths. Tests recursive merge depth traversal.
- **Large dataset, pinpoint (20)**: The key merge benchmark. Creates 10x N items (e.g., 10,000 for N=1000) with complex objects (7 properties, nested `metadata`), then merges only 3 items. JSONModel's `deepExtend` must deep-clone all 10,000 objects. SignalModel's in-place merge walks only the 3 payload items. Isolates the O(n) vs O(k) architectural difference.

## How It Works

### Bootstrap

The page loads UI5 via the standard bootstrap script served by `ui5 serve`. `ui5-tooling-transpile-middleware` transpiles TypeScript on-the-fly and `ui5-tooling-modules-middleware` resolves npm dependencies (`signal-polyfill`) into UI5-compatible modules.

### Module Loading

When "Run Benchmark" is clicked, `sap.ui.require` loads:

- `sap/ui/model/json/JSONModel` (from the OpenUI5 framework)
- `ui5/model/signal/SignalModel` (from the library, transpiled from TypeScript)
- Control classes: `sap/m/Text`, `sap/m/List`, `sap/m/Table`, `sap/m/Tree`, `sap/ui/table/Table`, and their list items/columns

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

1. `Promise.resolve().then(...)` - drains microtask queue (SignalModel's default `queueMicrotask` flush)
2. `setTimeout(resolve, 0)` - yields to macrotask queue (JSONModel's async `checkUpdate` and SignalModel's `bAsyncUpdate` bulk sync)
3. `queueMicrotask(resolve)` - final microtask drain for any cascaded notifications from the macrotask pass

### Statistics

Uses Bessel-corrected (sample) variance. Reports: median, mean, standard deviation, min, max, P5, P95. Median is the primary metric as it is robust to GC-caused outliers.

> [!NOTE]
> Results vary by hardware, browser engine, and system load. The numbers below are from a single reference run. Run the benchmarks on your own setup for representative numbers.

## Results (2000 bindings, 500 iterations, 20 rounds — OpenUI5 1.154.0)

> [!IMPORTANT]
> These numbers are from a single machine and browser configuration (OpenUI5 1.154.0, `signal-polyfill` 0.2.3, headless Chrome). **Results vary** across hardware, OS, browser version, background processes, and JIT warm-up state. Treat them as directional guidance, not guarantees. Run `npm run bench` or `npm run bench:stable` on your own machine for representative numbers.

![SignalModel vs JSONModel Benchmark](../../../../docs/benchmark-results.svg)

<details>
<summary>Full 22-scenario results table (2,000 bindings, 500 iter, 20 rounds)</summary>

| #   | Binding Type                | Scenario                              | JSONModel  | SignalModel | Comparison        |
| --- | --------------------------- | ------------------------------------- | ---------- | ----------- | ----------------- |
| 1   | Model API                   | setProperty (no bindings)             | 0.20 ms    | 0.10 ms     | ~equal            |
| 2   | Model API                   | getProperty                           | 0.10 ms    | 0.10 ms     | ~equal            |
| 3   | Property (`sap.m.Text`)     | Single-path update, 2000 bindings     | 5.45 ms    | 4.95 ms     | **1.10x faster**  |
| 4   | Property (`sap.m.Text`)     | Update all 2000 (sync)                | 1195.35 ms | 25.35 ms    | **47.15x faster** |
| 5   | Property (`sap.m.Text`)     | Update all 2000 (async)               | 22.95 ms   | 24.15 ms    | ~equal            |
| 6   | Property (`sap.m.Text`)     | Sparse async, 1 of 2000               | 5.25 ms    | 4.60 ms     | **1.14x faster**  |
| 7   | List (`sap.m.List`)         | List binding replace, 500 items       | 8.20 ms    | 8.35 ms     | ~equal            |
| 8   | List (`sap.m.Table`)        | Table binding replace, 500 rows       | 6.75 ms    | 7.40 ms     | ~equal            |
| 9   | List (`sap.ui.table.Table`) | Grid table binding replace, 2000 rows | 6.60 ms    | 7.05 ms     | ~equal            |
| 10  | Tree (`sap.m.Tree`)         | Tree binding replace, 200 nodes       | 9.20 ms    | 9.40 ms     | ~equal            |
| 11  | Expression (`sap.m.Text`)   | Expression binding, 500 controls      | 5.10 ms    | 5.00 ms     | ~equal            |
| 12  | Computed (`sap.m.Text`)     | Computed signals, 2000 computeds      | 5.30 ms    | 5.20 ms     | ~equal            |
| 13  | Computed (`sap.m.Text`)     | Computed (redefined), 2000 computeds  | 5.10 ms    | 4.80 ms     | ~equal            |
| 14  | Computed (`sap.m.Text`)     | Computed sub-path, 2000 computeds     | 6.00 ms    | 5.10 ms     | **1.18x faster**  |
| 15  | Computed (`sap.m.Text`)     | Computed redefine + sub-path, 2000    | 5.40 ms    | 5.20 ms     | ~equal            |
| 16  | Property (`sap.m.Text`)     | setData replace, 2000 bindings        | 24.80 ms   | 26.75 ms    | ~equal            |
| 17  | Property (`sap.m.Text`)     | setData merge (shallow), 5 into 2k    | 6.00 ms    | 5.10 ms     | **1.18x faster**  |
| 18  | Property (`sap.m.Text`)     | setData merge (deep), all 2k          | 26.40 ms   | 26.20 ms    | ~equal            |
| 19  | Property (`sap.m.Text`)     | setData merge (nested config)         | 6.00 ms    | 4.70 ms     | **1.28x faster**  |
| 20  | Property (`sap.m.Text`)     | setData merge (large, pinpoint) 20k   | 23.40 ms   | 5.00 ms     | **4.68x faster**  |
| 21  | Property (`sap.m.Text`)     | Real-world: checkPerformanceOfUpdate  | 35.60 ms   | 5.55 ms     | **6.41x faster**  |
| 22  | Property (`sap.m.Text`)     | Deep-path setProperty (no computeds)  | 5.45 ms    | 4.70 ms     | **1.16x faster**  |

</details>

### Honest Observations

**Where SignalModel is faster:**

"Update all N bindings (sync)" shows the largest difference: at 2,000 bindings, JSONModel takes ~1,195 ms vs SignalModel's ~25 ms (**~47x faster**). JSONModel's default synchronous `setProperty` calls `checkUpdate` after every write, iterating all bindings each time: O(N²) total (2,000 × 2,000 = 4,000,000 binding checks). SignalModel skips child-signal scanning for primitive leaf writes and notifies only the changed path: true O(N) total.

**The `bAsyncUpdate` path:**

JSONModel's `setProperty` accepts a `bAsyncUpdate` parameter that batches `checkUpdate` calls into a single `setTimeout` pass, collapsing O(N²) to O(N). SignalModel matches this using targeted dirty-path tracking (`_pendingAsyncPaths`): writes are recorded without firing synchronous watcher callbacks, and a single `setTimeout` syncs only the dirty paths and their deduplicated ancestor signals. Full-batch async updates are ~equal, while sparse async updates (1 of 2,000) are **~1.14x faster** because SignalModel avoids scanning unchanged bindings.

**In-place merge:**

The "large dataset, pinpoint merge" scenario (3 items into 20,000) is **~4.7x faster** (5.00 ms vs 23.40 ms). JSONModel's `deepExtend` deep-clones the entire 20,000-item array to overlay 3 items; SignalModel's `_mergeInPlace` walks only the 3 payload keys in-place (O(k) vs O(n)) and invalidates ancestors once at the merge root. Nested config merge is **~1.28x faster** and shallow merge is **~1.18x faster**. Deep merge covering all 2,000 items is ~equal.

**`checkPerformanceOfUpdate` threshold:**

Scenario 21 reproduces the conditions from SAP's `checkPerformanceOfUpdate` warning: 3,449 bindings with 29 consecutive synchronous `setProperty` calls (100,021 cumulative binding checks, exceeding SAP's 100k threshold). JSONModel takes ~35.6 ms vs SignalModel's ~5.6 ms (**~6.4x faster**).

**Computed redefinition and sub-path traversal have zero overhead:**

"Computed (redefined)" redefines all 500 computeds via `removeComputed` + `createComputed` with different dependencies, then measures update propagation. Performance is equivalent to regular computed signals. The re-subscribe bridge adds no measurable cost.

"Computed sub-path" binds 500 controls to sub-paths of computed objects (e.g., `/computed0/label`). The `_getObject` traversal checks `registry.isComputed()` at each path segment -- a Map lookup. Performance is equivalent to JSONModel's direct path binding.

"Computed redefine + sub-path" combines redefinition with sub-path bindings -- the most expensive computed path. It redefines all computeds and exercises `_firePathResubscribe`'s prefix scan to re-wire sub-path bindings to new signal objects. Performance is equivalent to JSONModel's direct path binding.

**Deep-path setProperty confirms zero computed overhead:**

"Deep-path setProperty (no computeds)" uses 4-segment paths (`/items/0/meta/value`) with N bindings but zero computed signals. This isolates the overhead of `_findComputedAncestor` and the `hasComputeds` guard on every write. At 2000 bindings, both models are ~equal, confirming the `hasComputeds` short-circuit eliminates all computed-related overhead for apps that don't use computeds.

**Where both models are equivalent:**

For list, table, grid table, and tree binding scenarios where the entire aggregation is replaced, both models perform equivalently. DOM rendering cost dominates the model notification cost. The model layer is not the bottleneck. The grid table (`sap.ui.table.Table`) uses row virtualization (20 visible rows out of 2000 total), so DOM cost is constant regardless of dataset size. Both models are ~equal at 2000 rows.

Expression binding, computed signals, getProperty, setProperty (no bindings), setData replace, and equal-sized merges are all equivalent.

**What SignalModel offers over JSONModel with `bAsyncUpdate`:**

1. **Correct by default.** Developers do not need to remember to pass `bAsyncUpdate=true`. SAP added `checkPerformanceOfUpdate` specifically because developers keep using the synchronous default. Without `bAsyncUpdate`, SignalModel is always O(1) per notification per `setProperty` call. With `bAsyncUpdate=true`, both models batch into a single pass.

2. **Per-path notification (default path).** Without `bAsyncUpdate`, each `setProperty` notifies only the bindings on the changed path -- O(1) per call. JSONModel's synchronous `setProperty` iterates ALL bindings each time -- O(N) per call. With `bAsyncUpdate=true`, both models iterate all bindings/signals in a single batched pass.

3. **Computed signals.** Model-layer derived values (`createComputed`) that update reactively. JSONModel has no equivalent; formatters are view-layer and do not participate in the model's dependency graph.

4. **In-place merge.** `setData(partial, true)` uses an O(k) in-place recursive merge instead of O(n) `deepExtend` clone. For large datasets with small merge payloads, measurably faster (~2x at 20k items, scaling linearly with data size).

> [!NOTE]
> **Native Signals outlook.** SignalModel currently uses [signal-polyfill](https://github.com/proposal-signals/signal-polyfill), a JavaScript implementation of the [TC39 Signals proposal](https://github.com/tc39/proposal-signals). When signals ship natively in browsers, the polyfill can be swapped for the native implementation with zero API changes. Native signals will be implemented in C++ by the browser engine, eliminating the JavaScript overhead of the polyfill's reactive graph traversal, watcher notification, and dependency tracking. The architectural advantages (O(1) notification, in-place merge) will remain, and the constant factors should improve across all signal-dependent scenarios.

## Background

- [openui5 issue 2600](https://github.com/UI5/openui5/issues/2600) - documents the `checkUpdate` O(N) bottleneck
- [openui5 issue 4351](https://github.com/UI5/openui5/issues/4351) - related DOM accumulation problem in large apps
- SAP commit `cb6c7f7a` - added `checkPerformanceOfUpdate` warning at 100,000 cumulative binding checks
