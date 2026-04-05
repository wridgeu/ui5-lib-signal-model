# Multi-Run Benchmark Stability Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `bench:stable` npm script that runs the CLI benchmark N times and produces a merged ASCII table with per-scenario stability verdicts.

**Architecture:** A single `scripts/run-benchmark-stable.mjs` script that loops N times, spawning `node scripts/run-benchmark.mjs --json <tmpfile>` each iteration. After all runs complete, it merges JSON results and renders a side-by-side ASCII table with verdict analysis. No changes to existing benchmark code.

**Tech Stack:** Node.js (>=22), `node:util` parseArgs, `node:child_process` spawn, `node:fs/promises`, `node:os` tmpdir, `node:path`

**Spec:** `docs/superpowers/specs/2026-04-05-bench-stable-multi-run-design.md`

---

## File Structure

| File                                    | Responsibility                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| `scripts/run-benchmark-stable.mjs`      | **New.** CLI arg parsing, run loop, JSON merging, ASCII table rendering, verdict logic |
| `package.json`                          | Add `bench:stable` script entry                                                        |
| `packages/lib/test/benchmark/README.md` | Add `bench:stable` documentation section                                               |

---

### Task 1: Create the stability script with CLI arg parsing and help

**Files:**

- Create: `scripts/run-benchmark-stable.mjs`

- [ ] **Step 1: Create the script with arg parsing, validation, and help text**

```javascript
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
```

- [ ] **Step 2: Verify the script parses args and prints help**

Run: `node scripts/run-benchmark-stable.mjs --help`
Expected: Help text prints and exits with code 0.

Run: `node scripts/run-benchmark-stable.mjs --runs abc`
Expected: Error message and exit code 1.

Run: `node scripts/run-benchmark-stable.mjs --runs 0`
Expected: Error message and exit code 1.

- [ ] **Step 3: Commit**

```bash
git add scripts/run-benchmark-stable.mjs
git commit -m "feat(bench): add stability script with CLI arg parsing (#14)"
```

---

### Task 2: Add the run loop that spawns N benchmark runs

**Files:**

- Modify: `scripts/run-benchmark-stable.mjs`

- [ ] **Step 1: Add the run loop after the validation block**

Append to the end of `scripts/run-benchmark-stable.mjs`:

```javascript
// ── ANSI escape codes ────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

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
```

- [ ] **Step 2: Verify the run loop works with a dry run (1 run, low settings)**

Run: `node scripts/run-benchmark-stable.mjs --runs 1 --bindings 50 --iterations 10 --rounds 2`
Expected: Single benchmark run completes, no crash. The script will hang after printing results because the merged table isn't implemented yet — that's fine, it means the run loop works. Kill with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add scripts/run-benchmark-stable.mjs
git commit -m "feat(bench): add run loop spawning N benchmark runs (#14)"
```

---

### Task 3: Add ratio computation, verdict logic, and merged ASCII table

**Files:**

- Modify: `scripts/run-benchmark-stable.mjs`

- [ ] **Step 1: Add ratio and verdict functions after the ANSI constants block**

Insert after the ANSI constants block (before the `// ── Run loop` comment):

```javascript
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
  const sorted = nonEqual.map((r) => r.ratio).sort((a, b) => a - b);
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
```

- [ ] **Step 2: Add the merged table rendering after the run loop**

Append to the end of `scripts/run-benchmark-stable.mjs` (after the `allResults` array is populated):

```javascript
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
```

- [ ] **Step 3: Add the JSON output at the very end of the script**

Append to the end of `scripts/run-benchmark-stable.mjs`:

```javascript
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
```

- [ ] **Step 4: Verify the script lints cleanly**

Run: `npm run lint`
Expected: No errors in `scripts/run-benchmark-stable.mjs`.

- [ ] **Step 5: Commit**

```bash
git add scripts/run-benchmark-stable.mjs
git commit -m "feat(bench): add merged table rendering and verdict logic (#14)"
```

---

### Task 4: Add the `bench:stable` npm script

**Files:**

- Modify: `package.json:27`

- [ ] **Step 1: Add the script entry**

In `package.json`, add `bench:stable` after the `bench` entry (line 27):

```json
"bench:stable": "node scripts/run-benchmark-stable.mjs",
```

So lines 27-28 become:

```json
"bench": "node scripts/run-benchmark.mjs",
"bench:stable": "node scripts/run-benchmark-stable.mjs",
```

- [ ] **Step 2: Verify the npm script resolves**

Run: `npm run bench:stable -- --help`
Expected: Help text prints and exits with code 0.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(bench): add bench:stable npm script (#14)"
```

---

### Task 5: Update the benchmark README

**Files:**

- Modify: `packages/lib/test/benchmark/README.md`

- [ ] **Step 1: Add a stability analysis section after the Quick Start block**

After the Quick Start code block (line 12), before `### Browser mode` (line 14), insert:

````markdown
### Multi-run stability analysis

`npm run bench:stable` runs the CLI benchmark multiple times and produces a merged table showing all runs side-by-side with per-scenario stability verdicts. This distinguishes stable performance wins from measurement noise.

```bash
npm run bench:stable                                       # 4 runs at 2000 bindings (defaults)
npm run bench:stable -- --runs 6 --bindings 1000
npm run bench:stable -- --runs 4 --json stability.json     # save merged results as JSON
```
````

| Flag             | Default | Description                     |
| ---------------- | ------- | ------------------------------- |
| `--runs N`       | `4`     | Number of benchmark runs        |
| `--bindings N`   | `2000`  | Number of UI5 property bindings |
| `--iterations N` | `500`   | Iterations per scenario         |
| `--rounds N`     | `20`    | Measured rounds per run         |
| `--json <file>`  | —       | Save merged results as JSON     |

**Verdict logic:**

- Each run is classified as `faster`, `slower`, or `~equal` using the same significance checks as the single-run CLI
- `~equal` is neutral — ignored when determining consistency
- If all non-equal runs agree (or all are `~equal`): **stable**
- If both `faster` and `slower` appear: **noise**

````

- [ ] **Step 2: Add `bench:stable` to the Quick Start code block**

On line 11 (the last line inside the Quick Start code block), add:

```bash
npm run bench:stable                                       # CLI — multi-run stability analysis
````

- [ ] **Step 3: Verify formatting**

Run: `npm run fmt:check`
Expected: No formatting errors.

- [ ] **Step 4: Commit**

```bash
git add packages/lib/test/benchmark/README.md
git commit -m "docs(bench): document bench:stable multi-run stability analysis (#14)"
```

---

### Task 6: End-to-end verification

- [ ] **Step 1: Run the full stability script with minimal settings**

Run: `npm run bench:stable -- --runs 2 --bindings 50 --iterations 10 --rounds 2`
Expected:

- Two complete benchmark runs with live terminal output
- A merged ASCII table with Run 1 and Run 2 columns plus Verdict column
- Summary line showing stable/noise counts

- [ ] **Step 2: Verify JSON output**

Run: `npm run bench:stable -- --runs 2 --bindings 50 --iterations 10 --rounds 2 --json test-stability.json`
Expected:

- `test-stability.json` is created
- Contains `timestamp`, `config` (with `runs: 2`), and `scenarios` array
- Each scenario has `runs` array with 2 entries, plus `verdict`, `direction`, `medianRatio`

Clean up: `rm test-stability.json`

- [ ] **Step 3: Verify lint passes**

Run: `npm run check`
Expected: Formatting, lint, and typecheck all pass.
