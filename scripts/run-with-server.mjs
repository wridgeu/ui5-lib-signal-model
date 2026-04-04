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

const server = spawn("npm", ["run", serverScript], {
  stdio: "pipe",
  shell: true,
});

server.stdout.pipe(process.stdout);
server.stderr.pipe(process.stderr);

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
  // On Windows, server.kill() only kills the npm process, not the child
  // ui5 serve process (no SIGTERM propagation). Use taskkill /T to kill
  // the entire process tree and avoid orphaned servers on port 8080.
  if (platform() === "win32") {
    try {
      execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
    } catch {
      // Process may have already exited
    }
  } else {
    server.kill();
  }
}
