# SignalModel vs JSONModel - Performance Benchmark

Self-contained benchmark comparing SignalModel and JSONModel across all binding types.

## Quick Start

```bash
npm run start:bench
```

This starts the library dev server and opens the benchmark page in your browser.

## What It Tests

The benchmark covers 10 scenarios across all binding types and model operations:

| #   | Binding Type              | Scenario                             | What It Measures                                      |
| --- | ------------------------- | ------------------------------------ | ----------------------------------------------------- |
| 1   | Model API                 | setProperty throughput (no bindings) | Raw per-call overhead of model layer                  |
| 2   | Model API                 | getProperty throughput               | Read performance                                      |
| 3   | Property (`sap.m.Text`)   | Single-path update, N bindings       | O(1) vs O(N) notification - the key benchmark         |
| 4   | Property (`sap.m.Text`)   | Update all N bindings                | O(N) vs O(N^2) cumulative cost                        |
| 5   | List (`sap.m.List`)       | List binding replace                 | Array replacement with `StandardListItem` template    |
| 6   | List (`sap.m.Table`)      | Table binding replace                | Row replacement with 3 `ColumnListItem` cells         |
| 7   | Tree (`sap.m.Tree`)       | Tree binding replace                 | Hierarchical data replacement with `StandardTreeItem` |
| 8   | Expression (`sap.m.Text`) | Expression binding                   | Composite `{= ${/path1} + ${/path2}}` re-evaluation   |
| 9   | Computed (`sap.m.Text`)   | Computed signals                     | `createComputed` dependency chain propagation         |
| 10  | Property (`sap.m.Text`)   | setData replace                      | Full data replacement propagation                     |

## How It Works

### Bootstrap

The page loads UI5 via the standard bootstrap script served by `ui5 serve`. The `ui5-tooling-transpile-middleware` transpiles TypeScript on-the-fly and `ui5-tooling-modules-middleware` resolves npm dependencies (`signal-polyfill`) into UI5-compatible modules.

### Module Loading

When "Run Benchmark" is clicked, `sap.ui.require` loads:

- `sap/ui/model/json/JSONModel` (from the OpenUI5 framework)
- `ui5/model/signal/SignalModel` (from our library, transpiled from TypeScript)
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

## Results (500 bindings, 500 iterations, 10 rounds)

![Benchmark Results](../../../docs/benchmark-full-results.png)

| Binding Type            | Scenario                         | JSONModel   | SignalModel | Comparison       |
| ----------------------- | -------------------------------- | ----------- | ----------- | ---------------- |
| Model API               | setProperty (no bindings)        | 0.20ms      | 0.20ms      | ~equal           |
| Model API               | getProperty                      | 0.10ms      | 0.10ms      | ~equal           |
| Property (sap.m.Text)   | Single-path update, 500 bindings | 4.50ms      | 5.30ms      | ~equal           |
| Property (sap.m.Text)   | Update all 500 bindings          | **50.90ms** | **11.00ms** | **4.63x faster** |
| List (sap.m.List)       | List binding replace, 500 items  | 19.20ms     | 19.00ms     | ~equal           |
| List (sap.m.Table)      | Table binding replace, 500 rows  | 18.00ms     | 19.00ms     | ~equal           |
| Tree (sap.m.Tree)       | Tree binding replace, 200 nodes  | 20.60ms     | 19.60ms     | ~equal           |
| Expression (sap.m.Text) | Expression binding, 500 controls | 5.10ms      | 4.70ms      | 1.09x faster     |
| Computed (sap.m.Text)   | Computed signals, 500 computeds  | 4.70ms      | 5.20ms      | ~equal           |
| Property (sap.m.Text)   | setData replace                  | 10.20ms     | 10.80ms     | ~equal           |

### Key Takeaway

The **"Update all N bindings"** scenario is where SignalModel shines. At 500 bindings, JSONModel takes 50.9ms (each `setProperty` iterates all 500 bindings = 250,000 total checks, exceeding SAP's 100k warning threshold). SignalModel takes 11ms (each `setProperty` notifies only the 1 changed binding = 500 total notifications). At 1000 bindings this becomes ~10x faster (189ms vs 19ms). This directly addresses the bottleneck documented in [SAP/openui5#2600](https://github.com/SAP/openui5/issues/2600).

For list, table, and tree binding scenarios where the entire aggregation is replaced, both models perform equivalently because the DOM rendering cost dominates the model notification cost.

## Background

- [SAP/openui5#2600](https://github.com/SAP/openui5/issues/2600) - documents the `checkUpdate` O(N) bottleneck
- [SAP/openui5#4351](https://github.com/SAP/openui5/issues/4351) - related DOM accumulation problem in large apps
- SAP commit `cb6c7f7a` - added `checkPerformanceOfUpdate` warning at 100,000 cumulative binding checks
