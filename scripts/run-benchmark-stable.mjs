/**
 * Multi-run benchmark stability script.
 *
 * Runs the CLI benchmark N times, collects JSON results from each run,
 * and produces a merged ASCII table showing all N runs side-by-side
 * with per-scenario stability verdicts.
 *
 * @example
 *   npm run bench:stable
 *   npm run bench:stable -- --runs 6 --bindings 2000
 *   npm run bench:stable -- --runs 4 --json stability.json
 *
 * @see {@link run-benchmark.mjs} Single-run benchmark CLI
 * @see {@link ../docs/superpowers/specs/2026-04-05-bench-stable-multi-run-design.md} Design spec
 */
import { spawn } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI ──────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "4" },
    bindings: { type: "string", default: "2000" },
    iterations: { type: "string", default: "500" },
    rounds: { type: "string", default: "20" },
    json: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help) {
  console.log(`Usage: npm run bench:stable -- [options]

Options:
  --runs N          Number of runs (default: 4)
  --bindings N      Number of bindings (default: 2000)
  --iterations N    Iterations per scenario (default: 500)
  --rounds N        Measured rounds per run (default: 20)
  --json <file>     Save merged results as JSON
  -h, --help        Show this help`);
  process.exit(0);
}

for (const [name, val] of Object.entries({
  runs: values.runs,
  bindings: values.bindings,
  iterations: values.iterations,
  rounds: values.rounds,
})) {
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    console.error(`Error: --${name} must be a positive integer (got "${val}")`);
    process.exit(1);
  }
}

const runs = Number(values.runs);
const bindings = values.bindings;
const iterations = values.iterations;
const rounds = values.rounds;
const jsonOutFile = values.json;

// ── ANSI escape codes ────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

// ── Ratio & verdict logic ────────────────────────────────────────────

/**
 * Compute the raw ratio and direction for a single run's scenario.
 *
 * Uses the same significance checks as bench.spec.mjs:
 * 1. Both medians < 1ms → equal (resolution floor)
 * 2. |diff| < pooled SD → equal (statistical insignificance)
 * 3. Signal median ≤ 0 → equal (division guard)
 * 4. Ratio below 10% threshold → equal
 *
 * @param {{ median: number, stddev: number }} signal
 * @param {{ median: number, stddev: number }} json
 * @returns {{ direction: "faster"|"slower"|"equal", ratio: number }}
 */
function computeRatio(signal, json) {
  const sm = signal.median;
  const jm = json.median;

  if (sm < 1 && jm < 1) return { direction: "equal", ratio: 1 };

  const pooledSD = Math.sqrt(signal.stddev ** 2 + json.stddev ** 2);
  if (Math.abs(jm - sm) < pooledSD) return { direction: "equal", ratio: 1 };
  if (sm <= 0) return { direction: "equal", ratio: 1 };

  const ratio = jm / sm;
  if (ratio >= 1.1) return { direction: "faster", ratio };
  if (ratio <= 0.9) return { direction: "slower", ratio: 1 / ratio };
  return { direction: "equal", ratio: 1 };
}

/**
 * Format a ratio cell for the merged table (no ANSI color).
 *
 * @param {{ direction: string, ratio: number }} r
 * @returns {string}
 */
function fmtCell(r) {
  if (r.direction === "equal") return "~equal";
  const label = r.ratio.toFixed(1) + "x";
  return r.direction === "faster" ? label + " faster" : label + " slower";
}

/**
 * Compute the stability verdict across all runs for a scenario.
 *
 * - equal is neutral (ignored for direction consistency)
 * - If all non-equal runs agree → stable
 * - If faster and slower both appear → noise
 *
 * @param {{ direction: string, ratio: number }[]} ratios
 * @returns {{ verdict: "stable"|"noise", direction: "faster"|"slower"|"equal", medianRatio: number }}
 */
function computeVerdict(ratios) {
  const nonEqual = ratios.filter((r) => r.direction !== "equal");

  if (nonEqual.length === 0) {
    return { verdict: "stable", direction: "equal", medianRatio: 1 };
  }

  const hasFaster = nonEqual.some((r) => r.direction === "faster");
  const hasSlower = nonEqual.some((r) => r.direction === "slower");

  if (hasFaster && hasSlower) {
    return { verdict: "noise", direction: "equal", medianRatio: 1 };
  }

  const direction = nonEqual[0].direction;
  const sorted = nonEqual.map((r) => r.ratio).toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianRatio = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  return { verdict: "stable", direction, medianRatio };
}

/**
 * Format the verdict column with ANSI color.
 *
 * @param {{ verdict: string, direction: string, medianRatio: number }} v
 * @returns {string}
 */
function fmtVerdict(v) {
  if (v.verdict === "noise") return YELLOW + "noise" + RESET;
  if (v.direction === "equal") return DIM + "stable: ~equal" + RESET;
  const label = `stable: ~${v.medianRatio.toFixed(1)}x ${v.direction}`;
  return (v.direction === "faster" ? GREEN : RED) + label + RESET;
}

// ── Run loop ─────────────────────────────────────────────────────────

/**
 * Spawn a single benchmark run and return parsed JSON results.
 *
 * @param {number} runIndex - 1-based run number (for display)
 * @returns {Promise<object>} Parsed JSON output from the benchmark
 */
async function runBenchmark(runIndex) {
  const tmpFile = join(tmpdir(), `bench-stable-${randomBytes(4).toString("hex")}.json`);

  console.log(`\n${BOLD}── Run ${runIndex} of ${runs} ──${RESET}\n`);

  const child = spawn(
    "node",
    [
      join(__dirname, "run-benchmark.mjs"),
      "--bindings",
      bindings,
      "--iterations",
      iterations,
      "--rounds",
      rounds,
      "--json",
      tmpFile,
    ],
    { stdio: "inherit" },
  );

  const code = await new Promise((resolve) => child.on("close", resolve));
  if (code !== 0) {
    console.error(`\n${RED}Run ${runIndex} failed with exit code ${code}${RESET}`);
    process.exit(1);
  }

  const raw = await readFile(tmpFile, "utf-8");
  const result = JSON.parse(raw);
  await unlink(tmpFile);
  return result;
}

const allResults = [];
for (let i = 1; i <= runs; i++) {
  allResults.push(await runBenchmark(i));
}

// ── Merge and render ─────────────────────────────────────────────────

const scenarioCount = allResults[0].results.length;

// Build per-scenario data: ratios across all runs
const scenarios = [];
for (let s = 0; s < scenarioCount; s++) {
  const name = allResults[0].results[s].name;
  const category = allResults[0].results[s].category;

  const ratios = allResults.map((run) => {
    const r = run.results[s];
    return computeRatio(r.signal, r.json);
  });

  const verdict = computeVerdict(ratios);
  scenarios.push({ name, category, ratios, verdict });
}

// Determine column widths
const runColWidth = 12;
const numCol = 3;
const scenarioCol = 42;
const verdictCol = 24;
const totalWidth = numCol + 2 + scenarioCol + 2 + runs * (runColWidth + 2) + verdictCol;
const SEP = "\u2500".repeat(totalWidth);

// Header
console.log(
  `\n${BOLD}SignalModel vs JSONModel${RESET}` +
    ` \u2014 ${bindings} bindings, ${runs} runs` +
    ` (${iterations} iter, ${rounds} rounds)\n`,
);

const runHeaders = Array.from({ length: runs }, (_, i) => `Run ${i + 1}`.padStart(runColWidth));
console.log(
  ` ${DIM}#${RESET}  ${"Scenario".padEnd(scenarioCol)}` +
    `  ${runHeaders.join("  ")}  ${"Verdict"}`,
);
console.log(SEP);

// Rows
for (let s = 0; s < scenarioCount; s++) {
  const sc = scenarios[s];
  const num = String(s + 1).padStart(2);
  const cells = sc.ratios.map((r) => fmtCell(r).padStart(runColWidth));
  console.log(
    `${CYAN}${num}${RESET}  ${sc.name.padEnd(scenarioCol)}` +
      `  ${cells.join("  ")}  ${fmtVerdict(sc.verdict)}`,
  );
}

console.log(SEP);

// Summary
const stableCount = scenarios.filter((s) => s.verdict.verdict === "stable").length;
const noiseCount = scenarios.filter((s) => s.verdict.verdict === "noise").length;
console.log(
  `\n${GREEN}${stableCount} stable${RESET}, ${noiseCount > 0 ? YELLOW : DIM}${noiseCount} noise${RESET}` +
    ` out of ${scenarioCount} scenarios\n`,
);

// ── JSON output ──────────────────────────────────────────────────────

if (jsonOutFile) {
  const output = {
    timestamp: new Date().toISOString(),
    config: {
      bindings: Number(bindings),
      iterations: Number(iterations),
      rounds: Number(rounds),
      runs,
    },
    scenarios: scenarios.map((sc, i) => ({
      name: sc.name,
      category: sc.category,
      runs: allResults.map((run) => ({
        json: run.results[i].json,
        signal: run.results[i].signal,
      })),
      verdict: sc.verdict.verdict,
      direction: sc.verdict.direction,
      medianRatio: sc.verdict.medianRatio,
    })),
  };
  await writeFile(jsonOutFile, JSON.stringify(output, null, 2));
  console.log(`Results saved to ${jsonOutFile}`);
}
