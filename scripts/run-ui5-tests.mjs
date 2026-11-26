// Runs OpenUI5's own tests of the JSON model and its bindings against SignalModel.
// The test files are downloaded for the UI5 version of packages/lib/ui5.yaml (not part of
// this repo). A test fails the run if it fails without being listed in
// expected-failures.json, or passes although it is listed.
// Usage: npm run test:ui5   (--update rewrites expected-failures.json; --json runs JSONModel
// instead, which must pass all tests and never rewrites the file)
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { remote } from "webdriverio";

const lib = join(dirname(fileURLToPath(import.meta.url)), "../packages/lib");
const dir = join(lib, "test/ui5native");
const expectedFile = join(dir, "expected-failures.json");
const version = /name: OpenUI5\s+version: "([\d.]+)"/.exec(
  readFileSync(join(lib, "ui5.yaml"), "utf8"),
)[1];
const TESTS = [
  "JSONBinding",
  "JSONListBinding",
  "JSONModel",
  "JSONPropertyBinding",
  "JSONTreeBinding",
  "JSONTwoWay",
];
const SOURCE = `https://raw.githubusercontent.com/UI5/openui5/${version}/src/sap.ui.core/test/sap/ui/core/qunit/json/`;
// source file -> where the page finds it
const FILES = {
  ...Object.fromEntries(TESTS.map((name) => [`${name}.qunit.js`, `${name}.qunit.js`])),
  "data/JSONModelFakeService.js": "data/JSONModelFakeService.js",
  "data/testdata.json": "test-resources/sap/ui/core/qunit/json/data/testdata.json",
  "data/testdata2.json": "test-resources/sap/ui/core/qunit/json/data/testdata2.json",
};

const upstream = join(dir, "upstream");
const versionFile = join(upstream, "version.txt");
if (
  existsSync(upstream) &&
  !(existsSync(versionFile) && readFileSync(versionFile, "utf8") === version)
) {
  rmSync(upstream, { recursive: true });
}
for (const [source, target] of Object.entries(FILES)) {
  const file = join(upstream, target);
  if (existsSync(file)) continue;
  const response = await fetch(SOURCE + source);
  if (!response.ok) throw new Error(`${response.status} for ${SOURCE + source}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, await response.text());
}
writeFileSync(versionFile, version);

const model = process.argv.includes("--json") ? "json" : "signal";
const baseUrl = process.env["TEST_BASE_URL"] || "http://localhost:8080";
const browser = await remote({
  logLevel: "silent",
  capabilities: { browserName: "chrome", "goog:chromeOptions": { args: ["--headless"] } },
});
const failed = {};
const messages = {};
let total = 0;
try {
  for (const name of TESTS) {
    await browser.url(
      `${baseUrl}/test-resources/ui5/model/signal/ui5native/index.html?file=${name}&model=${model}`,
    );
    await browser.waitUntil(() => browser.execute(() => window.__results?.done), {
      timeout: 120000,
      timeoutMsg: `${name}: the tests did not finish`,
    });
    const results = await browser.execute(() => window.__results);
    total += results.total;
    if (results.failed.length) failed[name] = results.failed.toSorted();
    messages[name] = results.messages;
    console.log(`${name}: ${results.total} tests, ${results.failed.length} failed`);
  }
} finally {
  await browser.deleteSession();
}

if (process.argv.includes("--update") && model === "signal") {
  writeFileSync(expectedFile, JSON.stringify(failed, null, 2) + "\n");
} else {
  const expected = model === "json" ? {} : JSON.parse(readFileSync(expectedFile, "utf8"));
  const problems = TESTS.flatMap((name) => {
    const [now, listed] = [failed[name] ?? [], expected[name] ?? []];
    return now
      .filter((test) => !listed.includes(test))
      .map((test) => `fails: ${name} :: ${test} :: ${messages[name][test]}`)
      .concat(
        listed
          .filter((test) => !now.includes(test))
          .map((test) => `passes, but is listed as failing: ${name} :: ${test}`),
      );
  });
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exit(1);
}
console.log(`OpenUI5 ${version}, ${model}: ${total} tests, as expected`);
