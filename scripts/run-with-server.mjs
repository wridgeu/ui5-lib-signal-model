/**
 * Server lifecycle manager for test and benchmark runners.
 *
 * Starts a dev server, waits for it to become ready, spawns a test
 * runner, then cleans up the server process tree on exit.
 *
 * Cross-platform: process tree cleanup uses platform-appropriate methods
 * (POSIX process groups on Unix/macOS, taskkill on Windows).
 *
 * @see {@link run-benchmark.mjs} Benchmark CLI (uses this script)
 * @see {@link ../packages/lib/test/wdio-qunit.conf.ts} QUnit config
 */
import { spawn, execSync } from "node:child_process";
import { platform } from "node:os";

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const readyUrl = getArg("--ready-url") || "http://localhost:8080";
const serverScript = getArg("--server-script") || "start:lib";
const testScript = getArg("--test-script") || "wdio:qunit";
const testBaseUrl = getArg("--test-base-url");

async function waitForServer(url, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server not ready at ${url} after ${maxAttempts}s`);
}

/**
 * Kill a process and its entire child tree.
 *
 * Node's ChildProcess.kill() only kills the direct process, not its
 * children. When `npm run start:lib` spawns `ui5 serve`, killing npm
 * leaves ui5 running as an orphan (blocking the port on next run).
 *
 * This function handles tree killing on all platforms:
 * - **Windows**: `taskkill /T /F` kills the entire process tree.
 *   Process groups (detached) are not used because Windows does not
 *   propagate signals to child processes via groups.
 * - **Unix/macOS**: The process is started with `detached: true` to
 *   create a process group. `process.kill(-pid)` sends SIGTERM to
 *   the entire group (npm + ui5 serve + any children).
 *
 * @param {import("node:child_process").ChildProcess} proc
 */
function killProcessTree(proc) {
  if (platform() === "win32") {
    try {
      execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: "ignore" });
    } catch {
      // Process may have already exited
    }
  } else {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      // Fallback: kill the direct process if group kill fails
      // (e.g., process already exited or not a group leader)
      try {
        proc.kill();
      } catch {
        // Already dead — nothing to do
      }
    }
  }
}

const isWin = platform() === "win32";
const server = spawn("npm", ["run", serverScript], {
  stdio: "pipe",
  shell: true,
  // On Unix/macOS, create a process group so killProcessTree can send
  // SIGTERM to the entire tree. Not needed on Windows where taskkill /T
  // handles tree killing without process groups.
  detached: !isWin,
});

server.stdout.pipe(process.stdout);
server.stderr.pipe(process.stderr);

// On Unix, the server is detached (process group leader). Unref it so
// Node doesn't keep the event loop alive solely because of the server's
// stdio pipes — if killProcessTree fails, the parent should still exit.
if (!isWin) server.unref();

try {
  await waitForServer(readyUrl);

  const testArgs = ["run", testScript];
  if (testBaseUrl) {
    testArgs.push("--", `--baseUrl=${testBaseUrl}`);
  }

  const test = spawn("npm", testArgs, {
    stdio: "inherit",
    shell: true,
  });

  const code = await new Promise((resolve) => test.on("close", resolve));
  process.exitCode = code;
} finally {
  killProcessTree(server);
}
