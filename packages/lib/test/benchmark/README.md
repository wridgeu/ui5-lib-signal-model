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
- If both `faster` and `slower` appear: **noise**
- A direction is only claimed when more than half of the runs show it; a win seen in a minority of runs is reported as `stable: ~equal`
- Otherwise: **stable**

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

The clock runs from the model call (`setProperty` / `setData`) until **the bound control holds the new value**. Every sample checks this on the control itself (`getText()`, list items, table cells); if the update never arrives the run fails instead of timing a no-op.

- **Repetition.** The operation is repeated until a sample spans at least 20 ms, and the mean time per operation is reported. This keeps every sample far above the 0.1 ms resolution of `performance.now()`, so microsecond-scale results are meaningful.
- **No timers in the timed region.** Waiting uses microtask hops (SignalModel's default `queueMicrotask` flush), then `MessageChannel` tasks. A `setTimeout(0)` wait would add the browser's nested-timer clamp (4 ms in Chrome, up to ~15 ms on Windows) to every sample and bury the model cost underneath it. Only the `bAsyncUpdate` scenarios (5, 6) include a timer: the one both models schedule themselves.
- **Rendering excluded.** `sap/ui/core/Rendering` is suspended while the clock runs. DOM rendering is the same work for both models; the benchmark compares the model, binding, and control-property layers.
- **Equivalent work.** Computed-signal scenarios (12-15) compare against a JSONModel formatter (or composite binding + formatter) that derives the same value, and both models write the same path.
- **Real item counts.** List, table, and tree scenarios raise the model size limit, which otherwise caps aggregation bindings at 100 entries.

> [!IMPORTANT]
> These are **propagation** timings, not frame times. In an application, a user-visible update also pays for DOM rendering and layout, which is identical for both models and often larger than the model cost. Expect end-to-end differences to be much smaller than the ratios below, except where JSONModel's cost is large in absolute terms (scenarios 4, 20, 21).

### Statistics

Per model: IQR outlier filtering, then median, mean, Bessel-corrected standard deviation, min, max, P5, P95. Median is the primary metric.

A difference is reported as faster/slower only if it exceeds **3 standard errors** and **10%**; otherwise it is `~equal`. The 3 SE bar (instead of 1.96) leaves headroom for ~10 samples per model and 22 comparisons per report.

## Results (2000 bindings, 4 runs x 20 rounds — OpenUI5 1.154.0)

> [!IMPORTANT]
> These numbers are from a single machine (`npm run bench:stable`: 4 runs, OpenUI5 1.154.0, `signal-polyfill` 0.2.3, headless Chrome 158, Windows 11). Each cell is the median of the 4 per-run medians; the comparison column is the multi-run verdict. **Results vary** across hardware, OS, and browser version. Treat them as directional guidance, not guarantees, and run `npm run bench:stable` on your own machine.

![SignalModel vs JSONModel Benchmark](../../../../docs/benchmark-results.svg)

<details>
<summary>Full 22-scenario results table (2,000 bindings, time per operation)</summary>

| #   | Binding Type                | Scenario                              | JSONModel | SignalModel | Comparison       |
| --- | --------------------------- | ------------------------------------- | --------- | ----------- | ---------------- |
| 1   | Model API                   | setProperty (no bindings), 500 calls  | 0.108 ms  | 65.8 µs     | **1.64x faster** |
| 2   | Model API                   | getProperty, 500 calls                | 77.8 µs   | 51.0 µs     | **1.53x faster** |
| 3   | Property (`sap.m.Text`)     | Single-path update, 2000 bindings     | 0.760 ms  | 2.7 µs      | **286x faster**  |
| 4   | Property (`sap.m.Text`)     | Update all 2000 (sync)                | 1161 ms   | 3.09 ms     | **376x faster**  |
| 5   | Property (`sap.m.Text`)     | Update all 2000 (async)               | 10.93 ms  | 12.57 ms    | ~equal           |
| 6   | Property (`sap.m.Text`)     | Sparse async, 1 of 2000               | 0.774 ms  | 22.6 µs     | **34.2x faster** |
| 7   | List (`sap.m.List`)         | List binding replace, 500 items       | 1.05 ms   | 1.02 ms     | ~equal           |
| 8   | List (`sap.m.Table`)        | Table binding replace, 500 rows       | 2.93 ms   | 3.24 ms     | ~equal           |
| 9   | List (`sap.ui.table.Table`) | Grid table binding replace, 2000 rows | 0.945 ms  | 0.806 ms    | ~equal           |
| 10  | Tree (`sap.m.Tree`)         | Tree binding replace, 200 nodes       | 1.45 ms   | 1.52 ms     | ~equal           |
| 11  | Expression (`sap.m.Text`)   | Expression binding, 500 controls      | 0.323 ms  | 5.4 µs      | **59.4x faster** |
| 12  | Computed (`sap.m.Text`)     | Computed signals, 2000 computeds      | 0.613 ms  | 4.1 µs      | **148x faster**  |
| 13  | Computed (`sap.m.Text`)     | Computed (redefined), 2000 computeds  | 0.534 ms  | 4.0 µs      | **135x faster**  |
| 14  | Computed (`sap.m.Text`)     | Computed sub-path, 2000 computeds     | 1.39 ms   | 4.7 µs      | **293x faster**  |
| 15  | Computed (`sap.m.Text`)     | Computed redefine + sub-path, 2000    | 0.593 ms  | 4.1 µs      | **146x faster**  |
| 16  | Property (`sap.m.Text`)     | setData replace, 2000 bindings        | 3.24 ms   | 2.87 ms     | ~equal           |
| 17  | Property (`sap.m.Text`)     | setData merge (shallow), 5 into 2k    | 1.24 ms   | 10.7 µs     | **116x faster**  |
| 18  | Property (`sap.m.Text`)     | setData merge (deep), all 2k          | 4.81 ms   | 2.99 ms     | ~equal           |
| 19  | Property (`sap.m.Text`)     | setData merge (nested config)         | 1.56 ms   | 4.7 µs      | **330x faster**  |
| 20  | Property (`sap.m.Text`)     | setData merge (large, pinpoint) 20k   | 24.72 ms  | 7.9 µs      | **3129x faster** |
| 21  | Property (`sap.m.Text`)     | Real-world: checkPerformanceOfUpdate  | 28.42 ms  | 52.6 µs     | **541x faster**  |
| 22  | Property (`sap.m.Text`)     | Deep-path setProperty (no computeds)  | 0.661 ms  | 3.2 µs      | **208x faster**  |

</details>

15 faster, 7 ~equal, 0 slower; all 22 verdicts were stable across the 4 runs.

### Honest Observations

**The pattern: O(bindings) vs O(changed paths).**

Every synchronous JSONModel write runs `checkUpdate` over all bindings of the model. With 2,000 bindings that costs ~0.7 ms per write no matter how little changed, and that fixed cost is what scenarios 3, 11-15, 17, 19 and 22 measure on the JSONModel side. SignalModel notifies only the bindings of the changed path, which takes a few microseconds. The large ratios are this one architectural difference showing up in different shapes, and they grow with the binding count (at 500 bindings the same scenarios are roughly 30-120x).

**Where it matters in absolute terms:**

- "Update all N bindings (sync)": 2,000 consecutive `setProperty` calls take ~1.16 s with JSONModel (2,000 x 2,000 = 4,000,000 binding checks, O(N²)) vs ~3 ms with SignalModel (O(N)).
- "Real-world: checkPerformanceOfUpdate" (3,449 bindings, 29 synchronous calls, 100,021 cumulative binding checks, just over SAP's warning threshold): ~28 ms vs ~53 µs.
- "setData merge (large, pinpoint)": merging 3 items into 20,000 takes ~25 ms with JSONModel, whose `deepExtend` clones the whole array, vs ~8 µs for SignalModel's in-place merge that walks only the payload (O(n) vs O(k)).

Everywhere else the JSONModel cost is already below 2 ms, so the ratio is real but the saving per update is under 2 ms.

**The `bAsyncUpdate` path:**

JSONModel's `setProperty` accepts a `bAsyncUpdate` parameter that batches `checkUpdate` calls into a single `setTimeout` pass, collapsing O(N²) to O(N). SignalModel tracks dirty paths (`_pendingAsyncPaths`) and syncs them in a single `setTimeout` as well. Updating all 2,000 bindings this way is ~equal (10.9 ms vs 12.6 ms; one of the four runs measured SignalModel slower, the other three equal). A sparse async update (1 of 2,000) is ~34x faster because SignalModel does not scan the unchanged bindings. Both timings include the model's own `setTimeout(0)` hop.

**Where both models are equivalent:**

Replacing a whole aggregation (list, table, grid table, tree) and `setData` replace are ~equal: the work is dominated by the controls updating their items, not by the model. A deep merge covering all 2,000 items is also ~equal by the 3 SE rule, although SignalModel measured ~1.5x faster in two of the four runs.

**Computed signals:**

Scenarios 12-15 compare a computed signal against a JSONModel formatter deriving the same value. Redefining computeds (`removeComputed` + `createComputed`) and binding to sub-paths of computed objects cost about the same as a plain computed (4-5 µs per update), so the re-subscribe bridge and the `_getObject` traversal add no measurable per-update cost. The cost of the redefinition itself is not timed.

**Deep paths:**

"Deep-path setProperty (no computeds)" writes a 4-segment path with zero computed signals. At ~3 µs it matches the single-path scenario, so the `_findComputedAncestor` / `hasComputeds` check adds nothing measurable for apps that do not use computeds.

**Raw model API:**

Without any bindings, 500 `setProperty` calls take ~0.11 ms (JSONModel) vs ~0.07 ms (SignalModel), and 500 `getProperty` calls ~0.08 ms vs ~0.05 ms. Both are a fraction of a microsecond per call.

**What is not measured:**

DOM rendering, layout, and paint (identical for both models), model and binding creation, memory, and the minified library build (the page loads sources from the dev server).

**What SignalModel offers over JSONModel with `bAsyncUpdate`:**

1. **Correct by default.** Developers do not need to remember to pass `bAsyncUpdate=true`. SAP added `checkPerformanceOfUpdate` specifically because developers keep using the synchronous default. Without `bAsyncUpdate`, SignalModel is always O(1) per notification per `setProperty` call. With `bAsyncUpdate=true`, both models batch into a single pass.

2. **Per-path notification (default path).** Without `bAsyncUpdate`, each `setProperty` notifies only the bindings on the changed path -- O(1) per call. JSONModel's synchronous `setProperty` iterates ALL bindings each time -- O(N) per call. With `bAsyncUpdate=true`, both models iterate all bindings/signals in a single batched pass.

3. **Computed signals.** Model-layer derived values (`createComputed`) that update reactively. JSONModel has no equivalent; formatters are view-layer and do not participate in the model's dependency graph.

4. **In-place merge.** `setData(partial, true)` uses an O(k) in-place recursive merge instead of O(n) `deepExtend` clone. For large datasets with small merge payloads the cost no longer depends on the data size (~25 ms vs ~8 µs at 20k items).

> [!NOTE]
> **Native Signals outlook.** SignalModel currently uses [signal-polyfill](https://github.com/proposal-signals/signal-polyfill), a JavaScript implementation of the [TC39 Signals proposal](https://github.com/tc39/proposal-signals). When signals ship natively in browsers, the polyfill can be swapped for the native implementation with zero API changes. Native signals will be implemented in C++ by the browser engine, eliminating the JavaScript overhead of the polyfill's reactive graph traversal, watcher notification, and dependency tracking. The architectural advantages (O(1) notification, in-place merge) will remain, and the constant factors should improve across all signal-dependent scenarios.

## Background

- [openui5 issue 2600](https://github.com/UI5/openui5/issues/2600) - documents the `checkUpdate` O(N) bottleneck
- [openui5 issue 4351](https://github.com/UI5/openui5/issues/4351) - related DOM accumulation problem in large apps
- SAP commit `cb6c7f7a` - added `checkPerformanceOfUpdate` warning at 100,000 cumulative binding checks
