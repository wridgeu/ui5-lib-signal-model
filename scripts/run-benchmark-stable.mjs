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
 * @see {@link ../docs/specs/2026-04-05-bench-stable-multi-run-design.md} Design spec
 */
import { spawn } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { cpus, release, tmpdir, totalmem, type } from "node:os";
import { join, dirname } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import {
  ANSI,
  describe,
  fmtX,
  median,
  summarizeRuns,
} from "../packages/lib/test/benchmark/bench-stats.mjs";

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

const { RESET, BOLD, DIM, GREEN, RED, CYAN } = ANSI;

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

  // wdio can exit 0 without having run the spec (e.g. a failed driver download)
  const raw = await readFile(tmpFile, "utf-8").catch(() => {
    console.error(`\n${RED}Run ${runIndex} exited without writing results${RESET}`);
    process.exit(1);
  });
  await unlink(tmpFile);
  return JSON.parse(raw);
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

const scenarios = scenarioNames
  .map((name, s) => {
    const runsForScenario = allResults.map((run, runIdx) => {
      const idx = runLookups[runIdx].get(name);
      if (idx === undefined) {
        console.error(
          `${RED}Error: scenario "${name}" not found in run ${runIdx + 1}.${RESET}\n` +
            `Run 1 has ${scenarioCount} scenarios, run ${runIdx + 1} has ${run.results.length}.`,
        );
        process.exit(1);
      }
      return { json: run.results[idx].json, signal: run.results[idx].signal };
    });
    // Paired per run: both models share that run's machine state
    const ratios = runsForScenario.map((r) => r.json.median / r.signal.median);
    return {
      name,
      category: allResults[0].results[s].category,
      runs: runsForScenario,
      ratios,
      jsonMedian: median(runsForScenario.map((r) => r.json.median)),
      signalMedian: median(runsForScenario.map((r) => r.signal.median)),
    };
  })
  .map((sc) => Object.assign(sc, summarizeRuns(sc.ratios)));

const runColWidth = 7;
const scenarioCol = 42;
const SEP = "\u2500".repeat(5 + scenarioCol + 2 + runs * (runColWidth + 2) + 44);

console.log(
  `\n${BOLD}SignalModel vs JSONModel${RESET}` +
    ` \u2014 ${bindings} bindings, ${runs} runs` +
    ` (${iterations} iter, ${rounds} rounds)\n` +
    `${DIM}Per-run cells: JSONModel time / SignalModel time (above 1 = SignalModel faster).` +
    ` Result: geometric mean with 95% confidence interval across runs.${RESET}\n`,
);

const runHeaders = Array.from({ length: runs }, (_, i) => `Run ${i + 1}`.padStart(runColWidth));
console.log(
  ` ${DIM}#${RESET}  ${"Scenario".padEnd(scenarioCol)}  ${runHeaders.join("  ")}  Result`,
);
console.log(SEP);

const COLOR = { faster: GREEN, slower: RED, unclear: DIM };
scenarios.forEach((sc, s) => {
  const cells = sc.ratios.map((r) => fmtX(r).padStart(runColWidth));
  console.log(
    `${CYAN}${String(s + 1).padStart(2)}${RESET}  ${sc.name.padEnd(scenarioCol)}` +
      `  ${cells.join("  ")}  ${COLOR[sc.verdict]}${describe(sc)}${RESET}`,
  );
});

console.log(SEP);

const count = (verdict) => scenarios.filter((sc) => sc.verdict === verdict).length;
const floorMs = median(allResults.map((run) => run.floorMs));
console.log(
  `\n${GREEN}${count("faster")} faster${RESET}, ${RED}${count("slower")} slower${RESET}, ` +
    `${DIM}${count("unclear")} no clear difference${RESET} out of ${scenarioCount} scenarios`,
);
console.log(
  `${DIM}Harness floor: ${(floorMs * 1000).toFixed(1)} \u00b5s per operation` +
    ` (setText + render pass, no model); included in every time.${RESET}\n`,
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
    environment: {
      ...allResults[0].environment,
      cpu: cpus()[0].model.trim(),
      memoryGb: Math.round(totalmem() / 2 ** 30),
      os: `${type()} ${release()}`,
      node: process.version,
    },
    floorMs,
    scenarios,
  };
  await writeFile(jsonOutFile, JSON.stringify(output, null, 2));
  console.log(`Results saved to ${jsonOutFile}`);
}
