/**
 * Shared statistics and significance-testing utilities for the benchmark suite.
 *
 * Used by both {@link bench.spec.mjs} (terminal output) and
 * {@link ../../scripts/run-benchmark-stable.mjs} (multi-run stability).
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
 * @returns {{ n: number, median: number, mean: number, stddev: number, min: number, max: number, p5: number, p95: number }}
 */
export function stats(arr) {
  const clean = filterOutliers(arr);
  const n = clean.length;
  const sorted = clean.toSorted((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const mean = clean.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? clean.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1) : 0;

  return {
    n,
    median,
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
 * 1. Both medians < 1ms → equal (resolution floor of `performance.now()`)
 * 2. Difference below standard error at 95% confidence → equal
 * 3. Signal median ≤ 0 → equal (division guard)
 * 4. Ratio below 10% threshold (1.10x) → equal
 *
 * The standard error is computed as:
 *   SE = sqrt(σ_signal² / n_signal + σ_json² / n_json)
 * and the threshold uses 1.96 * SE (≈ 95% confidence z-score).
 *
 * When sample counts are unavailable (n is undefined or 0), falls back
 * to the raw pooled SD for backwards compatibility with older result files.
 *
 * @param {{ median: number, stddev: number, n?: number }} signal
 * @param {{ median: number, stddev: number, n?: number }} json
 * @returns {{ direction: "faster"|"slower"|"equal", ratio: number }}
 */
export function computeRatio(signal, json) {
  const sm = signal.median;
  const jm = json.median;

  if (sm < 1 && jm < 1) return { direction: "equal", ratio: 1 };

  // Use standard error when sample counts are available, raw SD otherwise
  const nSignal = signal.n || 0;
  const nJson = json.n || 0;
  const hasN = nSignal > 1 && nJson > 1;

  const threshold = hasN
    ? 1.96 * Math.sqrt(signal.stddev ** 2 / nSignal + json.stddev ** 2 / nJson)
    : Math.sqrt(signal.stddev ** 2 + json.stddev ** 2);

  if (Math.abs(jm - sm) < threshold) return { direction: "equal", ratio: 1 };
  if (sm <= 0) return { direction: "equal", ratio: 1 };

  const ratio = jm / sm;
  if (ratio >= 1.1) return { direction: "faster", ratio };
  if (ratio <= 0.9) return { direction: "slower", ratio: 1 / ratio };
  return { direction: "equal", ratio: 1 };
}
