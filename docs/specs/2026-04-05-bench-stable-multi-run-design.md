# Multi-Run Stability Script Design

## Problem

Benchmark results vary across runs due to JIT warm-up, GC pauses, thermal throttling, and background activity. A single run cannot distinguish stable performance wins from measurement noise. Manual multi-run comparison is tedious and error-prone.

## Solution

A standalone `scripts/run-benchmark-stable.mjs` that runs the existing CLI benchmark N times, collects JSON results, and produces a merged ASCII table with a per-scenario speed-up ratio and confidence interval.

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
3. Merge all N result arrays, matching scenarios by name.
4. Render the merged ASCII table to `stdout`.
5. If `--json` is provided, write the merged JSON to the specified file.

## Merged ASCII Table

```
SignalModel vs JSONModel -- 2000 bindings, 4 runs (500 iter, 20 rounds)

 #  Scenario                                  Run 1    Run 2    Run 3    Run 4  Result
──────────────────────────────────────────────────────────────────────────────────────────────────
 4  Update all 2000 bindings (sync)             49x      53x      56x      50x  52x faster (47x-57x)
 5  Update all 2000 bindings (bAsyncUpdate)   0.98x    0.95x    0.98x    0.74x  no clear difference (0.73x-1.13x)
```

### Per-Run Cell Value

`jsonMedian / signalMedian` of that run: above 1 means SignalModel is faster. The ratio is paired within the run, because both models share that run's machine state.

## Result Column

Run-to-run variation is larger than the variation within a run, so the interval is built over runs (Kalibera & Jones, "Rigorous Benchmarking in Reasonable Time"):

1. Take the logarithm of each per-run ratio.
2. Report the geometric mean (`exp` of the mean log ratio) as the ratio.
3. Report a 95% confidence interval: mean log ratio ± t(0.975, runs − 1) × standard deviation / √runs, transformed back with `exp`.

| Condition                  | Label                                    | Color    |
| -------------------------- | ---------------------------------------- | -------- |
| Interval entirely above 1  | `{ratio}x faster ({low}x-{high}x)`       | green    |
| Interval entirely below 1  | `{ratio}x slower ({low}x-{high}x)`       | red      |
| Same, but effect below 10% | `marginally faster/slower {ratio}x (..)` | as above |
| Interval includes 1        | `no clear difference ({low}x-{high}x)`   | dim      |
| Single run                 | `{ratio}x (1 run, no interval)`          | dim      |

"No clear difference" is not a claim of equivalence: the interval shows what the data cannot rule out.

The implementation lives in `packages/lib/test/benchmark/bench-stats.mjs` (`summarizeRuns`, `describe`) with a self-check: `node packages/lib/test/benchmark/bench-stats.mjs`.

## Merged JSON Output

Written when `--json <file>` is provided.

```json
{
  "timestamp": "2026-04-05T12:00:00.000Z",
  "config": { "bindings": 2000, "iterations": 500, "rounds": 20, "runs": 4 },
  "environment": {
    "userAgent": "Mozilla/5.0 ... HeadlessChrome/158.0.0.0 ...",
    "ui5": "1.154.0",
    "cpu": "12th Gen Intel(R) Core(TM) i7-12700K",
    "memoryGb": 32,
    "os": "Windows_NT 10.0.26300",
    "node": "v26.10.0"
  },
  "floorMs": 0.0092,
  "scenarios": [
    {
      "name": "Update all 2000 bindings (sync)",
      "category": "Property (sap.m.Text)",
      "runs": [
        {
          "json": { "median": 1449.0, "...": "full stats incl. samples" },
          "signal": { "median": 27.4 }
        }
      ],
      "ratios": [49.3, 52.6, 55.9, 50.5],
      "jsonMedian": 1448.7,
      "signalMedian": 27.4,
      "ratio": 52.0,
      "low": 47.4,
      "high": 57.1,
      "verdict": "faster"
    }
  ]
}
```

Each entry in `runs` preserves the full statistical object from that run, including its raw samples. `jsonMedian` / `signalMedian` are each model's median across runs; `ratio`, `low`, `high`, `verdict` are the result column; `floorMs` is the median harness floor; `environment` is the first run's browser and UI5 version plus the machine the script ran on.

## Published Results

`scripts/render-benchmark-results.mjs` (`npm run bench:render`) reads `docs/benchmark-results.json`, a merged file as above, and regenerates `docs/benchmark-results.svg` and the marked results block in the benchmark README. It only formats: all numbers and wording come from the JSON and `describe`.

## File Changes

| File                                    | Change                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `scripts/run-benchmark-stable.mjs`      | **New.** Stability script.                                                |
| `package.json`                          | Add `"bench:stable": "node scripts/run-benchmark-stable.mjs"` to scripts. |
| `packages/lib/test/benchmark/README.md` | Add section documenting `bench:stable` usage.                             |
| `scripts/render-benchmark-results.mjs`  | **New.** Renders the published chart and table from the merged JSON.      |

The single-run CLI passes `floorMs` and raw samples through in its JSON for this script to merge.
