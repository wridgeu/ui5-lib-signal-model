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

| Flag             | Default | Description                          |
| ---------------- | ------- | ------------------------------------ |
| `--runs N`       | `4`     | Number of benchmark runs             |
| `--bindings N`   | `2000`  | Number of UI5 property bindings      |
| `--iterations N` | `500`   | Calls per operation in scenarios 1-2 |
| `--rounds N`     | `20`    | Measured rounds per run              |
| `--json <file>`  | --      | Save merged results as JSON          |

**Verdict logic:**

- Each run is classified as `faster`, `slower`, or `~equal` using the same significance checks as the single-run CLI
- Runs are combined as paired ratios (each run's JSONModel median / SignalModel median), which cancels machine-state differences between runs
- If both `faster` and `slower` appear: **noise**
- **stable** faster/slower: more than half of the runs are significant in that direction
- **marginally** faster/slower: not significant in a majority of runs, but every run leans the same way by at least 3% in the median
- Otherwise: **stable** `~equal`

### Browser mode

`npm run start:bench` starts the dev server and opens the benchmark page. Select binding count, iterations, and rounds from the dropdowns, then click "Run Benchmark".

### CLI mode

`npm run bench` runs all scenarios in headless Chrome via WDIO and streams results to the terminal as each scenario completes. No browser window opens.

| Flag             | Default | Description                                                         |
| ---------------- | ------- | ------------------------------------------------------------------- |
| `--bindings N`   | `500`   | Number of UI5 property bindings                                     |
| `--iterations N` | `500`   | Calls per operation in scenarios 1-2                                |
| `--rounds N`     | `20`    | Measured rounds (alternating A-B); N rounds = N/2 samples per model |
| `--json <file>`  | --      | Save results as JSON                                                |

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
| 12  | Computed (`sap.m.Text`)     | Computed signals                        | `createComputed` propagation vs. a JSONModel formatter          |
| 13  | Computed (`sap.m.Text`)     | Computed (redefined)                    | `removeComputed` + `createComputed` re-subscribe cost           |
| 14  | Computed (`sap.m.Text`)     | Computed sub-path                       | Sub-path of a computed object vs. composite binding + formatter |
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

Each sample:

1. Creates a fresh model with deep-copied data (`JSON.parse(JSON.stringify(...))`)
2. Creates real UI5 controls with declarative bindings, placed in a hidden `display:none` container
3. Runs 3 warmup rounds
4. Times the operation (see below)
5. Destroys all controls and the model

The `runAlternating` function interleaves JSON and Signal samples (JSON-Signal, Signal-JSON, JSON-Signal...) to cancel out GC pauses, thermal throttling, and JIT compilation bias. `--rounds 20` therefore yields 10 samples per model.

### What Is Timed

The clock runs from the model call (`setProperty` / `setData`) until **the bound control holds the new value and its DOM has been re-rendered**. Every sample checks the value on the control itself (`getText()`, list items, table cells); if the update never arrives the run fails instead of timing a no-op.

- **Repetition.** The operation is repeated until a sample spans at least 20 ms, and the mean time per operation is reported. This keeps every sample far above the 0.1 ms resolution of `performance.now()`, so microsecond-scale results are meaningful.
- **No timers in the timed region.** Waiting uses microtask hops (SignalModel's default `queueMicrotask` flush), then `MessageChannel` tasks. A `setTimeout(0)` wait would add the browser's nested-timer clamp (4 ms in Chrome, up to ~15 ms on Windows) to every sample and bury the model cost underneath it. Only the `bAsyncUpdate` scenarios (5, 6) include a timer: the one both models schedule themselves.
- **Rendering included, its timer is not.** UI5 schedules rendering with `setTimeout(0)`. The benchmark suspends that timer and runs the same render pass synchronously (`Rendering.renderPendingUIUpdates`) once the update has propagated, so samples contain the rendering work but not the timer wait.
- **Equivalent work.** Computed-signal scenarios (12-15) compare against a JSONModel formatter (or composite binding + formatter) that derives the same value, and both models write the same path.
- **Real item counts.** List, table, and tree scenarios raise the model size limit, which otherwise caps aggregation bindings at 100 entries.

> [!IMPORTANT]
> **What the numbers do and do not say.** Each number is the time from the model write until UI5 has re-rendered the affected controls' DOM. Not included: browser layout and paint (the controls sit in a hidden container), the `setTimeout(0)` UI5 normally waits before rendering, and model or binding creation. In a visible application every update additionally pays for layout and paint, which is the same for both models, so the ratios you observe on screen will be smaller than the ones below. The absolute savings (JSONModel time minus SignalModel time) carry over.

### Statistics

Per model: IQR outlier filtering, then median, mean, Bessel-corrected standard deviation, min, max, P5, P95. Median is the primary metric.

A difference is reported as faster/slower only if it exceeds **3 standard errors** and **10%**; otherwise it is `~equal`. The 3 SE bar (instead of 1.96) leaves headroom for ~10 samples per model and 22 comparisons per report.

## Results (2000 bindings, 4 runs x 20 rounds — OpenUI5 1.154.0)

> [!IMPORTANT]
> These numbers are from a single machine (`npm run bench:stable`: 4 runs, OpenUI5 1.154.0, `signal-polyfill` 0.2.3, headless Chrome 158, Windows 11, library served unminified from the dev server). The time columns are each model's median across the 4 runs; the comparison column is the multi-run verdict based on paired per-run ratios, so it can differ slightly from dividing the two columns. **Results vary** across hardware, OS, and browser version. Treat them as directional guidance, not guarantees, and run `npm run bench:stable` on your own machine.

![SignalModel vs JSONModel Benchmark](../../../../docs/benchmark-results.svg)

<details>
<summary>Full 22-scenario results table (2,000 bindings, time per operation: model write to re-rendered DOM)</summary>

| #   | Binding Type                | Scenario                              | JSONModel | SignalModel | Comparison                |
| --- | --------------------------- | ------------------------------------- | --------- | ----------- | ------------------------- |
| 1   | Model API                   | setProperty (no bindings), 500 calls  | 0.129 ms  | 72.4 µs     | **1.67x faster**          |
| 2   | Model API                   | getProperty, 500 calls                | 0.104 ms  | 68.1 µs     | **1.51x faster**          |
| 3   | Property (`sap.m.Text`)     | Single-path update, 2000 bindings     | 0.772 ms  | 17.2 µs     | **48.9x faster**          |
| 4   | Property (`sap.m.Text`)     | Update all 2000 (sync)                | 1449 ms   | 27.35 ms    | **51.5x faster**          |
| 5   | Property (`sap.m.Text`)     | Update all 2000 (async)               | 27.33 ms  | 27.85 ms    | marginally slower (1.04x) |
| 6   | Property (`sap.m.Text`)     | Sparse async, 1 of 2000               | 0.960 ms  | 34.5 µs     | **27.7x faster**          |
| 7   | List (`sap.m.List`)         | List binding replace, 500 items       | 47.53 ms  | 51.08 ms    | marginally slower (1.03x) |
| 8   | List (`sap.m.Table`)        | Table binding replace, 500 rows       | 15.94 ms  | 14.48 ms    | ~equal                    |
| 9   | List (`sap.ui.table.Table`) | Grid table binding replace, 2000 rows | 1.27 ms   | 1.25 ms     | ~equal                    |
| 10  | Tree (`sap.m.Tree`)         | Tree binding replace, 200 nodes       | 11.23 ms  | 11.58 ms    | ~equal                    |
| 11  | Expression (`sap.m.Text`)   | Expression binding, 500 controls      | 0.394 ms  | 18.0 µs     | **21.0x faster**          |
| 12  | Computed (`sap.m.Text`)     | Computed signals, 2000 computeds      | 0.876 ms  | 21.3 µs     | **39.8x faster**          |
| 13  | Computed (`sap.m.Text`)     | Computed (redefined), 2000 computeds  | 0.599 ms  | 21.4 µs     | **30.7x faster**          |
| 14  | Computed (`sap.m.Text`)     | Computed sub-path, 2000 computeds     | 1.87 ms   | 21.2 µs     | **83.2x faster**          |
| 15  | Computed (`sap.m.Text`)     | Computed redefine + sub-path, 2000    | 0.664 ms  | 19.3 µs     | **38.2x faster**          |
| 16  | Property (`sap.m.Text`)     | setData replace, 2000 bindings        | 31.92 ms  | 33.65 ms    | ~equal                    |
| 17  | Property (`sap.m.Text`)     | setData merge (shallow), 5 into 2k    | 2.15 ms   | 86.0 µs     | **25.2x faster**          |
| 18  | Property (`sap.m.Text`)     | setData merge (deep), all 2k          | 32.07 ms  | 34.80 ms    | ~equal                    |
| 19  | Property (`sap.m.Text`)     | setData merge (nested config)         | 1.68 ms   | 15.8 µs     | **99.0x faster**          |
| 20  | Property (`sap.m.Text`)     | setData merge (large, pinpoint) 20k   | 22.10 ms  | 41.0 µs     | **529x faster**           |
| 21  | Property (`sap.m.Text`)     | Real-world: checkPerformanceOfUpdate  | 36.08 ms  | 0.384 ms    | **91.1x faster**          |
| 22  | Property (`sap.m.Text`)     | Deep-path setProperty (no computeds)  | 0.806 ms  | 17.3 µs     | **46.3x faster**          |

</details>

15 faster, 5 ~equal, 2 marginally slower (3-4%), 0 significantly slower. No scenario flipped between faster and slower across the 4 runs.

### Honest Observations

**The pattern: O(bindings) vs O(changed paths).**

Every synchronous JSONModel write runs `checkUpdate` over all bindings of the model. With 2,000 bindings that is a fixed ~0.8 ms per write no matter how little changed, and that fixed cost is what scenarios 3, 11-15, 17, 19 and 22 measure on the JSONModel side. SignalModel notifies only the bindings of the changed path; including the re-render of the one affected control this takes ~17-21 µs. The 20-100x ratios in those scenarios are this one architectural difference in different shapes. They grow with the number of bindings on the model and shrink with the amount of rendering an update triggers.

**Where it matters in absolute terms:**

- "Update all N bindings (sync)": 2,000 consecutive `setProperty` calls take ~1.45 s with JSONModel (2,000 x 2,000 = 4,000,000 binding checks, O(N²)) vs ~27 ms with SignalModel (O(N)), **~51x faster**. The ~27 ms is mostly re-rendering 2,000 controls.
- "Real-world: checkPerformanceOfUpdate" (3,449 bindings, 29 synchronous calls, 100,021 cumulative binding checks, just over SAP's warning threshold): ~36 ms vs ~0.38 ms, **~91x faster**.
- "setData merge (large, pinpoint)": merging 3 items into 20,000 takes ~22 ms with JSONModel, whose `deepExtend` clones the whole array, vs ~41 µs for SignalModel's in-place merge that walks only the payload (O(n) vs O(k)), **~529x faster**.

In the other "faster" scenarios JSONModel is already below 2.2 ms per update. The ratio is real, but the saving is at most ~2 ms per update.

**The `bAsyncUpdate` path:**

JSONModel's `setProperty` accepts a `bAsyncUpdate` parameter that batches `checkUpdate` calls into a single `setTimeout` pass, collapsing O(N²) to O(N). SignalModel tracks dirty paths (`_pendingAsyncPaths`) and syncs them in a single `setTimeout` as well. Both timings include that `setTimeout(0)` hop.

- Updating all 2,000 bindings this way: 27.3 ms vs 27.9 ms. SignalModel is **marginally slower (~4%)**: every one of the four runs leaned that way (paired ratios 0.98, 0.95, 0.98, 0.74), though only one run was statistically significant. With `bAsyncUpdate`, JSONModel is at least as fast as SignalModel for full batches.
- A sparse async update (1 of 2,000): 0.96 ms vs ~35 µs, ~28x faster, because SignalModel does not scan the unchanged bindings.

**Where SignalModel is not faster:**

- "List binding replace" (`sap.m.List`, 500 items): 47.5 ms vs 51.1 ms, **marginally slower (~3%)**, consistently across all four runs.
- Table, grid table, and tree replace, `setData` replace, and a deep merge covering all 2,000 items are ~equal: individual runs lean both ways. Here the time goes into the controls rebuilding and re-rendering their content, not into the model.

**Computed signals:**

Scenarios 12-15 compare a computed signal against a JSONModel formatter deriving the same value. Redefining computeds (`removeComputed` + `createComputed`) and binding to sub-paths of computed objects cost the same as a plain computed (~20 µs per update including the re-render), so the re-subscribe bridge and the `_getObject` traversal add no measurable per-update cost. The cost of the redefinition itself is not timed.

**Deep paths:**

"Deep-path setProperty (no computeds)" writes a 4-segment path with zero computed signals. At ~17 µs it matches the single-path scenario, so the `_findComputedAncestor` / `hasComputeds` check adds nothing measurable for apps that do not use computeds.

**Raw model API:**

Without any bindings, 500 `setProperty` calls take ~0.13 ms (JSONModel) vs ~0.07 ms (SignalModel), and 500 `getProperty` calls ~0.10 ms vs ~0.07 ms. Both are a fraction of a microsecond per call; the difference is irrelevant in practice.

**What is not measured:**

Browser layout and paint, the `setTimeout(0)` before UI5's render pass, model and binding creation, memory, and the minified library build.

**What SignalModel offers over JSONModel with `bAsyncUpdate`:**

1. **Correct by default.** Developers do not need to remember to pass `bAsyncUpdate=true`. SAP added `checkPerformanceOfUpdate` specifically because developers keep using the synchronous default. Without `bAsyncUpdate`, SignalModel is always O(1) per notification per `setProperty` call. With `bAsyncUpdate=true`, both models batch into a single pass.

2. **Per-path notification (default path).** Without `bAsyncUpdate`, each `setProperty` notifies only the bindings on the changed path -- O(1) per call. JSONModel's synchronous `setProperty` iterates ALL bindings each time -- O(N) per call. With `bAsyncUpdate=true`, both models iterate all bindings/signals in a single batched pass.

3. **Computed signals.** Model-layer derived values (`createComputed`) that update reactively. JSONModel has no equivalent; formatters are view-layer and do not participate in the model's dependency graph.

4. **In-place merge.** `setData(partial, true)` uses an O(k) in-place recursive merge instead of O(n) `deepExtend` clone. For large datasets with small merge payloads the cost no longer depends on the data size (~22 ms vs ~41 µs at 20k items).

> [!NOTE]
> **Native Signals outlook.** SignalModel currently uses [signal-polyfill](https://github.com/proposal-signals/signal-polyfill), a JavaScript implementation of the [TC39 Signals proposal](https://github.com/tc39/proposal-signals). When signals ship natively in browsers, the polyfill can be swapped for the native implementation with zero API changes. Native signals will be implemented in C++ by the browser engine, eliminating the JavaScript overhead of the polyfill's reactive graph traversal, watcher notification, and dependency tracking. The architectural advantages (O(1) notification, in-place merge) will remain, and the constant factors should improve across all signal-dependent scenarios.

## Background

- [openui5 issue 2600](https://github.com/UI5/openui5/issues/2600) - documents the `checkUpdate` O(N) bottleneck
- [openui5 issue 4351](https://github.com/UI5/openui5/issues/4351) - related DOM accumulation problem in large apps
- SAP commit `cb6c7f7a` - added `checkPerformanceOfUpdate` warning at 100,000 cumulative binding checks
