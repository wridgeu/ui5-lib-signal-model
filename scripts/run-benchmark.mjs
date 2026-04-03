/**
 * CLI entry point for the SignalModel benchmark runner.
 *
 * Parses command-line arguments, maps them to environment variables,
 * and delegates to {@link run-with-server.mjs} which starts the UI5
 * dev server and then launches the WDIO benchmark spec.
 *
 * Architecture:
 * ```
 * run-benchmark.mjs          (this file — arg parsing, env setup)
 *   └─ run-with-server.mjs   (server lifecycle — start, wait, cleanup)
 *       ├─ ui5 serve          (serves the benchmark HTML page)
 *       └─ wdio run ...       (headless Chrome → benchmark page)
 *           └─ bench.spec.mjs (polls results, formats terminal output)
 * ```
 *
 * @example
 *   npm run bench
 *   npm run bench -- --bindings 1000 --iterations 500 --rounds 10
 *   npm run bench -- --bindings 2000 --json results.json
 *
 * @see {@link ../packages/lib/test/benchmark/bench.spec.mjs} WDIO spec
 * @see {@link ../packages/lib/test/benchmark/wdio-bench.conf.ts} WDIO config
 */
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    bindings: { type: "string", default: "500" },
    iterations: { type: "string", default: "500" },
    rounds: { type: "string", default: "10" },
    json: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (values.help) {
  console.log(`Usage: npm run bench -- [options]

Options:
  --bindings N      Number of bindings (default: 500)
  --iterations N    Iterations per scenario (default: 500)
  --rounds N        Measured rounds (default: 10)
  --json <file>     Save results to JSON file
  -h, --help        Show this help`);
  process.exit(0);
}

const env = {
  ...process.env,
  BENCH_BINDINGS: values.bindings,
  BENCH_ITERATIONS: values.iterations,
  BENCH_ROUNDS: values.rounds,
};

if (values.json) {
  env.BENCH_JSON = values.json;
}

const child = spawn(
  "node",
  [
    "scripts/run-with-server.mjs",
    "--ready-url",
    "http://localhost:8080",
    "--server-script",
    "start:lib",
    "--test-script",
    "wdio:bench",
  ],
  { stdio: "inherit", env },
);

const code = await new Promise((resolve) => child.on("close", resolve));
process.exitCode = code;
