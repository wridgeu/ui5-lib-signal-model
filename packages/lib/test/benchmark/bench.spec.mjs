/**
 * WDIO benchmark spec — CLI-native benchmark runner.
 *
 * Drives a headless Chrome session against the benchmark HTML page,
 * polls {@link window.__bench} for streaming results, and formats
 * them as a terminal table. Optionally saves results as JSON.
 *
 * Configuration is passed via environment variables (set by
 * {@link ../../scripts/run-benchmark.mjs}):
 *
 * | Env var            | Default | Description                    |
 * |--------------------|---------|--------------------------------|
 * | `BENCH_BINDINGS`   | `500`   | Number of UI5 bindings         |
 * | `BENCH_ITERATIONS` | `500`   | Iterations per scenario        |
 * | `BENCH_ROUNDS`     | `10`    | Measured rounds (alternating)  |
 * | `BENCH_JSON`       | —       | Path to save JSON results to   |
 *
 * @example
 *   BENCH_BINDINGS=1000 wdio run packages/lib/test/benchmark/wdio-bench.conf.ts
 *
 * @see {@link index.html} Benchmark page (owns all benchmark logic)
 * @see {@link wdio-bench.conf.ts} WDIO configuration
 */
import { writeFile } from "node:fs/promises";

// ── ANSI escape codes ────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

/** Horizontal rule for the results table. */
const SEP = "\u2500".repeat(88);

// ── Formatting helpers ───────────────────────────────────────────────

/**
 * Format a millisecond value as a right-aligned, fixed-width string.
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {string} e.g. `"    12.34 ms"`
 */
function fmtMs(ms) {
  return ms.toFixed(2).padStart(9) + " ms";
}

/**
 * Compute and format the ratio between SignalModel and JSONModel medians.
 *
 * Uses the same significance checks as the benchmark HTML page:
 * 1. Both below 1ms → `~equal` (resolution floor of `performance.now()`)
 * 2. Absolute difference below pooled standard deviation → `~equal`
 * 3. Ratio below 10% (1.10x) → `~equal`
 *
 * @param {{ median: number, stddev: number }} signal - SignalModel stats
 * @param {{ median: number, stddev: number }} json - JSONModel stats
 * @returns {string} ANSI-colored ratio string
 */
function fmtRatio(signal, json) {
  const sm = signal.median;
  const jm = json.median;

  if (sm < 1 && jm < 1) return DIM + "~equal" + RESET;

  const pooledSD = Math.sqrt(signal.stddev ** 2 + json.stddev ** 2);
  if (Math.abs(jm - sm) < pooledSD) return DIM + "~equal" + RESET;
  if (sm <= 0) return DIM + "~equal" + RESET;

  const ratio = jm / sm;
  if (ratio >= 1.1) return GREEN + ratio.toFixed(2) + "x faster" + RESET;
  if (ratio <= 0.9) return RED + (1 / ratio).toFixed(2) + "x slower" + RESET;
  return DIM + "~equal" + RESET;
}

// ── Configuration ────────────────────────────────────────────────────

const bindings = process.env.BENCH_BINDINGS || "500";
const iterations = process.env.BENCH_ITERATIONS || "500";
const rounds = process.env.BENCH_ROUNDS || "10";
const jsonFile = process.env.BENCH_JSON || "";

// ── Spec ─────────────────────────────────────────────────────────────

describe("Benchmark", function () {
  it("runs all scenarios", async function () {
    const url = [
      "/test-resources/ui5/model/signal/benchmark/index.html",
      `?n=${bindings}&iterations=${iterations}&rounds=${rounds}&autorun`,
    ].join("");

    await browser.url(url);

    // Wait for UI5 bootstrap and benchmark initialization.
    // The HTML page sets `window.__bench` at the start of `runBenchmark()`,
    // which is triggered by the `autorun` URL parameter after UI5 loads.
    await browser.waitUntil(async () => browser.execute(() => window.__bench != null), {
      timeout: 60_000,
      interval: 500,
      timeoutMsg:
        "Benchmark page did not initialize within 60s. " +
        "Check that UI5 loaded and the autorun parameter was accepted.",
    });

    const startTime = Date.now();
    let lastCount = 0;
    let headerPrinted = false;

    // Poll `window.__bench` for results and stream each one to the
    // terminal as it arrives. The benchmark page pushes results to
    // `window.__bench.results` after each scenario completes and sets
    // `window.__bench.done = true` when all 17 scenarios are finished.
    await browser.waitUntil(
      async () => {
        const state = await browser.execute(() => ({
          config: window.__bench.config,
          count: window.__bench.results.length,
          done: window.__bench.done,
        }));

        if (!headerPrinted && state.config) {
          headerPrinted = true;
          const { bindings: b, iterations: it, rounds: r } = state.config;
          console.log(
            `\n${BOLD}SignalModel vs JSONModel${RESET}` +
              ` \u2014 ${b} bindings, ${it} iter, ${r} rounds\n`,
          );
          console.log(
            ` ${DIM}#${RESET}  ${"Scenario".padEnd(45)}` +
              ` ${"JSONModel".padStart(12)} ${"SignalModel".padStart(12)}   vs JSON`,
          );
          console.log(SEP);
        }

        // Fetch and print newly completed scenarios since last poll
        if (state.count > lastCount) {
          const newResults = await browser.execute(
            (from) => window.__bench.results.slice(from),
            lastCount,
          );
          for (const r of newResults) {
            lastCount++;
            const num = String(lastCount).padStart(2);
            console.log(
              `${CYAN}${num}${RESET}  ${r.name.padEnd(45)}` +
                ` ${fmtMs(r.json.median)} ${fmtMs(r.signal.median)}` +
                `   ${fmtRatio(r.signal, r.json)}`,
            );
          }
        }

        return state.done;
      },
      {
        timeout: 600_000,
        interval: 2_000,
        timeoutMsg:
          "Benchmark did not complete within 10 minutes. " +
          `Completed ${lastCount} scenarios before timeout.`,
      },
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(SEP);
    console.log(`\n${GREEN}Done${RESET} in ${elapsed}s \u2014 ${lastCount} scenarios`);

    // Persist results as JSON if requested via BENCH_JSON env var.
    if (jsonFile) {
      const results = await browser.execute(() => window.__bench.results);
      const output = {
        timestamp: new Date().toISOString(),
        config: {
          bindings: Number(bindings),
          iterations: Number(iterations),
          rounds: Number(rounds),
        },
        results,
      };
      await writeFile(jsonFile, JSON.stringify(output, null, 2));
      console.log(`Results saved to ${jsonFile}`);
    }
  });
});
