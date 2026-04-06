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
 * @see {@link ../packages/lib/test/benchmark/bench-stats.mjs} Shared statistics
 * @see {@link ../docs/superpowers/specs/2026-04-05-bench-stable-multi-run-design.md} Design spec
 */
import { spawn } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { ANSI, computeRatio } from "../packages/lib/test/benchmark/bench-stats.mjs";

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

// ── ANSI shortcuts ──────────────────────────────────────────────────

const { RESET, BOLD, DIM, GREEN, RED, YELLOW, CYAN } = ANSI;

// ── Formatting helpers ──────────────────────────────────────────────

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
    await unlink(tmpFile).catch(() => {});
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

// Build a name→index lookup from the first run's results. Subsequent runs
// are matched by scenario name instead of array position, so reordering
// or conditional scenarios across runs won't silently misalign data.
const scenarioNames = allResults[0].results.map((r) => r.name);
const scenarioCount = scenarioNames.length;

/** @type {Map<string, number>[]} Lookup maps for each run */
const runLookups = allResults.map((run) => {
  const map = new Map();
  for (let i = 0; i < run.results.length; i++) {
    map.set(run.results[i].name, i);
  }
  return map;
});

const scenarios = [];
for (let s = 0; s < scenarioCount; s++) {
  const name = scenarioNames[s];
  const category = allResults[0].results[s].category;

  const ratios = allResults.map((run, runIdx) => {
    const idx = runLookups[runIdx].get(name);
    if (idx === undefined) {
      console.error(
        `${RED}Error: scenario "${name}" not found in run ${runIdx + 1}.${RESET}\n` +
          `Run 1 has ${scenarioCount} scenarios, run ${runIdx + 1} has ${run.results.length}.`,
      );
      process.exit(1);
    }
    const r = run.results[idx];
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
    scenarios: scenarios.map((sc) => ({
      name: sc.name,
      category: sc.category,
      runs: allResults.map((run, runIdx) => {
        const idx = runLookups[runIdx].get(sc.name);
        return {
          json: run.results[idx].json,
          signal: run.results[idx].signal,
        };
      }),
      verdict: sc.verdict.verdict,
      direction: sc.verdict.direction,
      medianRatio: sc.verdict.medianRatio,
    })),
  };
  await writeFile(jsonOutFile, JSON.stringify(output, null, 2));
  console.log(`Results saved to ${jsonOutFile}`);
}
