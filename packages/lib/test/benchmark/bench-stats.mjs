/**
 * Comparison statistics for the benchmark suite.
 *
 * Used by both {@link bench.spec.mjs} (terminal output) and
 * {@link ../../scripts/run-benchmark-stable.mjs} (multi-run stability).
 * Self-check: `node packages/lib/test/benchmark/bench-stats.mjs`.
 *
 * The browser-side {@link index.html} has its own copy of the single-run
 * rule in `fmtRatio` (it cannot import ES modules from Node). When changing
 * {@link computeRatio}, update it there too.
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

// ── Single run ──────────────────────────────────────────────────────

/**
 * Classify one run: is SignalModel faster, slower, or not distinguishable?
 *
 * A difference counts only if it exceeds 3 standard errors, with
 *   SE = sqrt(σ_signal² / n_signal + σ_json² / n_json),
 * and 10%. This is an indication for a single run, not a hypothesis test:
 * "equal" means no difference was detected. {@link summarizeRuns} gives a
 * confidence interval across runs.
 *
 * @param {{ median: number, stddev: number, n: number }} signal SignalModel stats
 * @param {{ median: number, stddev: number, n: number }} json JSONModel stats
 * @returns {{ direction: "faster"|"slower"|"equal", ratio: number }} Ratio with direction
 */
export function computeRatio(signal, json) {
  const threshold = 3 * Math.sqrt(signal.stddev ** 2 / signal.n + json.stddev ** 2 / json.n);
  if (Math.abs(json.median - signal.median) < threshold) return { direction: "equal", ratio: 1 };

  const ratio = json.median / signal.median;
  if (ratio >= 1.1) return { direction: "faster", ratio };
  if (ratio <= 0.9) return { direction: "slower", ratio: 1 / ratio };
  return { direction: "equal", ratio: 1 };
}

// ── Multiple runs ───────────────────────────────────────────────────

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

/** Two-sided 95% critical values of Student's t for 1..30 degrees of freedom. */
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145,
  2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048,
  2.045, 2.042,
];

/**
 * Summarize one scenario across runs as a speed-up ratio with a 95%
 * confidence interval.
 *
 * Input is one paired ratio per run (JSONModel median / SignalModel median;
 * above 1 means SignalModel is faster). Both models share a run's machine
 * state, so the ratio cancels differences between runs. Run-to-run variation
 * is the largest source of variance, so the interval is built over runs: a
 * t-interval on the log ratios, reported around their geometric mean.
 *
 * @param {number[]} ratios Per-run JSONModel/SignalModel ratios
 * @returns {{ ratio: number, low: number|null, high: number|null, verdict: "faster"|"slower"|"unclear" }}
 *   `verdict` is "faster"/"slower" when the whole interval lies on one side
 *   of 1; `low`/`high` are null for a single run
 */
export function summarizeRuns(ratios) {
  const n = ratios.length;
  const logs = ratios.map(Math.log);
  const mean = logs.reduce((sum, l) => sum + l, 0) / n;
  const ratio = Math.exp(mean);
  if (n < 2) return { ratio, low: null, high: null, verdict: "unclear" };

  const sd = Math.sqrt(logs.reduce((sum, l) => sum + (l - mean) ** 2, 0) / (n - 1));
  const half = ((T95[n - 2] ?? 1.96) * sd) / Math.sqrt(n);
  const low = Math.exp(mean - half);
  const high = Math.exp(mean + half);
  return { ratio, low, high, verdict: low > 1 ? "faster" : high < 1 ? "slower" : "unclear" };
}

/**
 * Format a ratio: two significant digits from 10x up, two decimals below.
 *
 * @param {number} ratio Ratio to format
 * @returns {string} e.g. `"49x"`, `"530x"`, `"1.04x"`
 */
export function fmtX(ratio) {
  return (ratio >= 10 ? String(Number(ratio.toPrecision(2))) : ratio.toFixed(2)) + "x";
}

/**
 * Describe a {@link summarizeRuns} result in words.
 *
 * @param {{ ratio: number, low: number|null, high: number|null, verdict: string }} summary Result to describe
 * @returns {string} e.g. `"49x faster (41x-56x)"`, `"marginally slower 1.04x (1.01x-1.07x)"`,
 *   `"no clear difference (0.88x-1.02x)"`
 */
export function describe({ ratio, low, high, verdict }) {
  if (low === null) return `${fmtX(ratio)} (1 run, no interval)`;
  if (verdict === "unclear") return `no clear difference (${fmtX(low)}-${fmtX(high)})`;
  // Express "slower" as how many times slower, so the number is above 1 either way.
  const [r, lo, hi] = verdict === "faster" ? [ratio, low, high] : [1 / ratio, 1 / high, 1 / low];
  const range = `(${fmtX(lo)}-${fmtX(hi)})`;
  return r < 1.1 ? `marginally ${verdict} ${fmtX(r)} ${range}` : `${fmtX(r)} ${verdict} ${range}`;
}

// ── Self-check (`node bench-stats.mjs`) ─────────────────────────────

if (import.meta.main) {
  const { deepStrictEqual: eq, ok } = await import("node:assert");
  const stat = (med, stddev) => ({ median: med, stddev, n: 10 });
  const near = (actual, expected) =>
    ok(Math.abs(actual - expected) < 1e-3, `${actual} != ${expected}`);

  eq(computeRatio(stat(1, 0.1), stat(5, 0.1)), { direction: "faster", ratio: 5 });
  eq(computeRatio(stat(5, 0.1), stat(1, 0.1)), { direction: "slower", ratio: 5 });
  eq(computeRatio(stat(1, 4), stat(5, 4)).direction, "equal"); // within 3 SE
  eq(computeRatio(stat(1, 0.001), stat(1.05, 0.001)).direction, "equal"); // below 10% faster
  eq(computeRatio(stat(1.05, 0.001), stat(1, 0.001)).direction, "equal"); // below 10% slower

  eq(median([3, 1, 2]), 2);
  eq(median([4, 1, 2, 3]), 2.5);

  // Expected intervals computed independently: exp(mean ± t(0.975, 3) * sd / sqrt(4)) of the logs
  const fast = summarizeRuns([40, 50, 45, 55]);
  eq(fast.verdict, "faster");
  near(fast.ratio, 47.168);
  near(fast.low, 37.925);
  near(fast.high, 58.665);
  eq(describe(fast), "47x faster (38x-59x)");

  eq(describe(summarizeRuns([0.5, 0.52, 0.48, 0.5])), "2.00x slower (1.90x-2.11x)");
  eq(describe(summarizeRuns([0.96, 0.97, 0.95, 0.96])), "marginally slower 1.04x (1.03x-1.06x)");
  // one outlier run among near-equal ones must not produce a verdict
  eq(describe(summarizeRuns([0.29, 0.95, 1.04, 0.99])), "no clear difference (0.27x-1.95x)");
  eq(describe(summarizeRuns([2])), "2.00x (1 run, no interval)");
  // two runs: df = 1, so only a very consistent difference counts
  eq(summarizeRuns([1.2, 1.5]).verdict, "unclear");

  eq(fmtX(529.3), "530x");
  eq(fmtX(48.9), "49x");
  eq(fmtX(1.036), "1.04x");
  console.log("bench-stats self-check passed");
}
