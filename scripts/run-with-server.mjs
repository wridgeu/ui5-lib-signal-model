import { spawn } from "node:child_process";

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
  server.kill();
}
