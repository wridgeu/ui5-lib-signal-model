/**
 * Shared statistics and significance-testing utilities for the benchmark suite.
 *
 * Used by both {@link bench.spec.mjs} (terminal output) and
 * {@link ../../scripts/run-benchmark-stable.mjs} (multi-run stability).
 * Self-check: `node packages/lib/test/benchmark/bench-stats.mjs`.
 *
 * The browser-side {@link index.html} has its own copy of these functions
 * (it cannot import ES modules from Node). When changing logic here,
 * update the corresponding functions in index.html to stay in sync.
 *
 * @module bench-stats
 */

// ── ANSI escape codes ────────────────────────────────────────────────

export const ANSI = {
  RESET: "\x1b[0m",
  BOLD: "\x1b[1m",
  DIM: "\x1b[2m",
  GREEN: "\x1b[32m",
  RED: "\x1b[31m",
  YELLOW: "\x1b[33m",
  CYAN: "\x1b[36m",
};

// ── Outlier filtering ───────────────────────────────────────────────

/**
 * Remove outliers using the IQR (Interquartile Range) method.
 *
 * Samples below Q1 - 1.5*IQR or above Q3 + 1.5*IQR are removed.
 * This is the standard Tukey fence approach used by Criterion, JMH,
 * and other mature benchmarking frameworks.
 *
 * Returns the original array unchanged if it has fewer than 4 elements
 * (IQR is meaningless with too few samples).
 *
 * @param {number[]} arr - Raw sample timings
 * @returns {number[]} Filtered array with outliers removed
 */
export function filterOutliers(arr) {
  if (arr.length < 4) return arr;

  const sorted = arr.toSorted((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;

  const filtered = arr.filter((v) => v >= lower && v <= upper);
  // If filtering would remove more than half the data, the distribution
  // is likely bimodal — return unfiltered to avoid masking real behavior.
  return filtered.length >= arr.length / 2 ? filtered : arr;
}

// ── Statistical summary ─────────────────────────────────────────────

/**
 * Compute statistical summary of a timing array.
 *
 * Applies IQR outlier filtering first, then computes Bessel-corrected
 * (n-1) sample variance on the cleaned data. Includes the post-filter
 * sample count `n` so downstream significance tests can compute
 * standard error.
 *
 * @param {number[]} arr - Array of timing samples (milliseconds)
 * @returns {{ n: number, median: number, mean: number, stddev: number, min: number, max: number, p5: number, p95: number }} Descriptive statistics
 */
export function stats(arr) {
  const clean = filterOutliers(arr);
  const n = clean.length;
  const sorted = clean.toSorted((a, b) => a - b);
  const mean = clean.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? clean.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1) : 0;

  return {
    n,
    median: median(clean),
    mean,
    stddev: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[n - 1],
    p5: sorted[Math.floor(n * 0.05)],
    p95: sorted[Math.ceil(n * 0.95) - 1],
  };
}

// ── Significance testing ────────────────────────────────────────────

/**
 * Compute the ratio and direction between SignalModel and JSONModel stats.
 *
 * Significance checks (in order):
 * 1. Difference below 3 standard errors → equal
 * 2. Signal median ≤ 0 → equal (division guard)
 * 3. Ratio below 10% threshold (1.10x) → equal
 *
 * The standard error is computed as:
 *   SE = sqrt(σ_signal² / n_signal + σ_json² / n_json)
 * 3 * SE (rather than 1.96) leaves headroom for the small sample counts
 * (~10 per model) and for running 22 comparisons per report. There is no
 * sub-millisecond cutoff: every sample spans at least 20 ms of repeated
 * operations, so small per-operation medians are well above timer resolution.
 *
 * When sample counts are unavailable (n is undefined or 0), falls back
 * to the raw pooled SD for backwards compatibility with older result files.
 *
 * @param {{ median: number, stddev: number, n?: number }} signal SignalModel stats
 * @param {{ median: number, stddev: number, n?: number }} json JSONModel stats
 * @returns {{ direction: "faster"|"slower"|"equal", ratio: number }} Ratio with significance direction
 */
export function computeRatio(signal, json) {
  const sm = signal.median;
  const jm = json.median;

  // Use standard error when sample counts are available, raw SD otherwise
  const nSignal = signal.n || 0;
  const nJson = json.n || 0;
  const hasN = nSignal > 1 && nJson > 1;

  const threshold = hasN
    ? 3 * Math.sqrt(signal.stddev ** 2 / nSignal + json.stddev ** 2 / nJson)
    : Math.sqrt(signal.stddev ** 2 + json.stddev ** 2);

  if (Math.abs(jm - sm) < threshold) return { direction: "equal", ratio: 1 };
  if (sm <= 0) return { direction: "equal", ratio: 1 };

  const ratio = jm / sm;
  if (ratio >= 1.1) return { direction: "faster", ratio };
  if (ratio <= 0.9) return { direction: "slower", ratio: 1 / ratio };
  return { direction: "equal", ratio: 1 };
}

// ── Multi-run aggregation ───────────────────────────────────────────

/**
 * Median of a list of numbers.
 *
 * @param {number[]} values Numbers to aggregate
 * @returns {number} Median value
 */
export function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute the stability verdict across several runs of one scenario.
 *
 * Runs are aggregated as paired ratios: each run's JSONModel median divided
 * by its SignalModel median. Both models share a run's machine state, so the
 * per-run ratio cancels differences between runs that two separate per-model
 * medians would keep.
 *
 * - noise: significant `faster` and `slower` both appear
 * - stable faster/slower: more than half of the runs are significant in that direction
 * - marginal faster/slower: not significant in a majority of runs, but every
 *   run leans the same way and the median difference is at least 3%
 * - stable equal: everything else
 *
 * @param {{ direction: "faster"|"slower"|"equal", raw: number }[]} runs
 *   Per-run results; `raw` is jsonMedian / signalMedian
 * @returns {{ verdict: "stable"|"marginal"|"noise", direction: "faster"|"slower"|"equal", medianRatio: number }}
 *   Aggregated verdict; `medianRatio` is >= 1 in the reported direction (1 for equal)
 */
export function computeVerdict(runs) {
  const count = (direction) => runs.filter((r) => r.direction === direction).length;
  const faster = count("faster");
  const slower = count("slower");
  const paired = median(runs.map((r) => r.raw));
  const toward = (direction) => (direction === "faster" ? paired : 1 / paired);

  if (faster > 0 && slower > 0) {
    return { verdict: "noise", direction: "equal", medianRatio: 1 };
  }
  for (const [direction, significant] of [
    ["faster", faster],
    ["slower", slower],
  ]) {
    if (significant * 2 > runs.length) {
      return { verdict: "stable", direction, medianRatio: toward(direction) };
    }
    const allLean = runs.every((r) => (direction === "faster" ? r.raw > 1 : r.raw < 1));
    if (allLean && toward(direction) >= 1.03) {
      return { verdict: "marginal", direction, medianRatio: toward(direction) };
    }
  }
  return { verdict: "stable", direction: "equal", medianRatio: 1 };
}

// ── Self-check (runs only when executed directly) ───────────────────

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replaceAll("\\", "/").split("/").pop())
) {
  const { deepStrictEqual: eq } = await import("node:assert");
  const run = (direction, raw) => ({ direction, raw });
  const v = (runs) => computeVerdict(runs);
  eq(v([run("faster", 3), run("faster", 5), run("faster", 4), run("equal", 2)]).verdict, "stable");
  eq(v([run("faster", 3), run("faster", 5), run("faster", 4)]).medianRatio, 4);
  eq(v([run("faster", 2), run("slower", 0.5), run("equal", 1)]).verdict, "noise");
  // one significant run out of four is not a stable result, and the runs do not all lean one way
  eq(v([run("slower", 0.29), run("equal", 0.95), run("equal", 1.04), run("equal", 0.99)]), {
    verdict: "stable",
    direction: "equal",
    medianRatio: 1,
  });
  // every run leans slower without reaching significance
  eq(v([run("equal", 0.9), run("equal", 0.8), run("equal", 0.95), run("equal", 0.9)]), {
    verdict: "marginal",
    direction: "slower",
    medianRatio: 1 / 0.9,
  });
  eq(v([run("equal", 1.01), run("equal", 1.02)]).verdict, "stable");
  console.log("bench-stats self-check passed");
}
