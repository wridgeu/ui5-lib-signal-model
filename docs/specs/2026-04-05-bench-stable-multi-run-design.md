# Multi-Run Stability Script Design

## Problem

Benchmark results vary across runs due to JIT warm-up, GC pauses, thermal throttling, and background activity. A single run cannot distinguish stable performance wins from measurement noise. Manual multi-run comparison is tedious and error-prone.

## Solution

A standalone `scripts/run-benchmark-stable.mjs` that runs the existing CLI benchmark N times, collects JSON results, and produces a merged ASCII table with per-scenario stability verdicts.

## CLI Interface

```
npm run bench:stable -- [options]

Options:
  --runs N          Number of runs (default: 4)
  --bindings N      Number of bindings (default: 2000)
  --iterations N    Iterations per scenario (default: 500)
  --rounds N        Measured rounds per run (default: 20)
  --json <file>     Save merged results as JSON
  -h, --help        Show help
```

`--runs` and `--json` are consumed by the stability script. All other options are passed through to `run-benchmark.mjs`.

## Execution Flow

1. Parse and validate CLI args using `node:util` `parseArgs()`.
2. For each run `1..N`:
   - Create a temp JSON file path via `os.tmpdir()`.
   - Spawn `node scripts/run-benchmark.mjs --json <tmp> --bindings X --iterations Y --rounds Z`.
   - Stream child `stdout`/`stderr` to parent so the user sees live progress per run.
   - On exit (code 0), read and parse the temp JSON, then delete the temp file.
   - On non-zero exit, abort with an error message indicating which run failed.
3. Merge all N result arrays, matching scenarios by array index.
4. Render the merged ASCII table to `stdout`.
5. If `--json` is provided, write the merged JSON to the specified file.

## Merged ASCII Table

```
SignalModel vs JSONModel — 2000 bindings, 4 runs (500 iter, 20 rounds)

 #  Scenario                                  Run 1       Run 2       Run 3       Run 4       Verdict
─────────────────────────────────────────────────────────────────────────────────────────────────────────
 1  setProperty (no bindings)                 ~equal      ~equal      ~equal      ~equal      stable: ~equal
 4  Update all 2000 (sync)                    15.7x       13.1x       15.4x       15.4x       stable: ~15x faster
 5  Update all 2000 (async)                   ~equal      ~equal      ~equal      ~equal      stable: ~equal
```

### Per-Run Cell Value

Each run's ratio is computed from that run's JSON data using the same logic as the existing `fmtRatio` in `bench.spec.mjs`:

1. Both medians < 1ms: `~equal` (resolution floor).
2. `|jsonMedian - signalMedian| < pooledSD`: `~equal` (statistical insignificance).
3. Signal median <= 0: `~equal` (division guard).
4. `jsonMedian / signalMedian >= 1.1`: `{ratio}x faster`.
5. `jsonMedian / signalMedian <= 0.9`: `{ratio}x slower`.
6. Otherwise: `~equal`.

Cell display: `~equal`, `13.1x faster`, or `1.3x slower` (no ANSI color in cells, color only on the verdict column).

## Verdict Logic

Each run is classified into a direction: `faster`, `slower`, or `equal`.

- `equal` is **neutral** — ignored when determining consistency.
- If all non-equal directions agree, or all runs are equal: **stable**.
- If both `faster` and `slower` appear across runs: **noise**.

### Verdict Labels

| Condition                          | Label                             | Color  |
| ---------------------------------- | --------------------------------- | ------ |
| All runs `equal`                   | `stable: ~equal`                  | dim    |
| Non-equal runs all `faster`        | `stable: ~{median_ratio}x faster` | green  |
| Non-equal runs all `slower`        | `stable: ~{median_ratio}x slower` | red    |
| Both `faster` and `slower` present | `noise`                           | yellow |

The `{median_ratio}` is the median of the ratios from all non-equal runs, displayed with one decimal place.

## Merged JSON Output

Written when `--json <file>` is provided.

```json
{
  "timestamp": "2026-04-05T12:00:00.000Z",
  "config": {
    "bindings": 2000,
    "iterations": 500,
    "rounds": 20,
    "runs": 4
  },
  "scenarios": [
    {
      "name": "Update all 2000 bindings (sync)",
      "category": "Property (sap.m.Text)",
      "runs": [
        {
          "json": {
            "median": 800.0,
            "mean": 810.5,
            "stddev": 15.2,
            "min": 780.0,
            "max": 850.0,
            "p5": 785.0,
            "p95": 845.0
          },
          "signal": {
            "median": 50.0,
            "mean": 52.3,
            "stddev": 3.1,
            "min": 47.0,
            "max": 60.0,
            "p5": 48.0,
            "p95": 58.0
          }
        }
      ],
      "verdict": "stable",
      "direction": "faster",
      "medianRatio": 15.1
    }
  ]
}
```

Each entry in `runs` preserves the full statistical object from the original benchmark run. The `verdict`, `direction`, and `medianRatio` fields are the computed stability analysis.

## File Changes

| File                                    | Change                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `scripts/run-benchmark-stable.mjs`      | **New.** Stability script.                                                |
| `package.json`                          | Add `"bench:stable": "node scripts/run-benchmark-stable.mjs"` to scripts. |
| `packages/lib/test/benchmark/README.md` | Add section documenting `bench:stable` usage.                             |

No modifications to existing benchmark code (`run-benchmark.mjs`, `bench.spec.mjs`, `index.html`).
