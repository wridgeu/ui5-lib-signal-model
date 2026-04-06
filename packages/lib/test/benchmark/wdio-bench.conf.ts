/**
 * WDIO configuration for the benchmark CLI runner.
 *
 * Runs a single spec ({@link bench.spec.mjs}) in headless Chrome.
 * Output is handled entirely by the spec itself (terminal table formatting),
 * so WDIO logging and reporters are suppressed.
 *
 * Invoked via: `wdio run packages/lib/test/benchmark/wdio-bench.conf.ts`
 *
 * @see {@link bench.spec.mjs} Benchmark spec with terminal output
 * @see {@link ../../scripts/run-benchmark.mjs} CLI wrapper
 */
export const config = {
  runner: "local",
  specs: ["./*.spec.mjs"],
  capabilities: [
    {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: ["--headless"],
      },
    },
  ],
  reporters: [["dot", { stdout: false }]],
  logLevel: "silent" as const,
  baseUrl: process.env["TEST_BASE_URL"] || "http://localhost:8080",
  waitforTimeout: 60_000,
  mochaOpts: {
    timeout: 600_000,
  },
};
