import SignalModel from "ui5/model/signal/SignalModel";
import JSONModel from "sap/ui/model/json/JSONModel";

/**
 * Differential test: the same random sequence of writes runs against JSONModel and
 * SignalModel, and after every step the data must match and every SignalModel binding
 * must show what JSONModel holds at its path.
 * Seeds are fixed, so a failure names the seed and step to replay.
 */

/** Deterministic PRNG (mulberry32). */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Point {
  x = 1;
}
const SHARED_SYMBOL = Symbol("fuzz");

/** Factories, so each model gets its own copy of object values. */
const VALUES: (() => unknown)[] = [
  () => 0,
  () => 1,
  () => -1.5,
  () => NaN,
  () => "",
  () => "0",
  () => "text",
  () => "a longer text",
  () => true,
  () => false,
  () => null,
  () => undefined,
  () => ({}),
  () => ({ v: 1 }),
  () => ({ v: 2, nested: { v: 3 } }),
  () => ({ length: 3 }),
  () => [],
  () => [1, 2, 3],
  () => [{ name: "a" }, { name: "b" }],
  () => new Date(0),
  () => BigInt(10),
  () => SHARED_SYMBOL,
  () => (): number => 1,
  () => new Point(),
  () => ({ at: new Point(), when: new Date(0) }),
  () => new Map([["k", 1]]),
  () => new Set([1]),
  () => {
    const sparse: unknown[] = [1];
    sparse[2] = 3;
    return sparse;
  },
];

const WRITE_PATHS = [
  "/s",
  "/n",
  "/zero",
  "/flag",
  "/nul",
  "/obj",
  "/obj/v",
  "/obj/nested",
  "/obj/nested/v",
  "/list",
  "/list/0",
  "/list/0/name",
  "/list/1",
  "/list/3",
  "/list/length",
  "/missing",
  "/missing/x",
];

const READ_PATHS = [
  ...WRITE_PATHS,
  "/",
  "/s/length",
  "/s/0",
  "/zero/x",
  "/flag/x",
  "/list/length",
  "/list/1/name",
  "/obj/nested/v/deeper",
  "/obj/length",
];

const initialData = (): Record<string, unknown> => ({
  s: "Al",
  n: 42,
  zero: 0,
  flag: false,
  nul: null,
  obj: { v: 1, nested: { v: 2 } },
  list: [{ name: "a" }, { name: "b" }],
});

const show = (value: unknown): string => {
  if (value instanceof Date) return `Date(${value.getTime()})`;
  if (typeof value !== "object" || value === null) return `${typeof value} ${String(value)}`;
  const name = (Object.getPrototypeOf(value) as { constructor?: { name: string } } | null)
    ?.constructor?.name;
  return `${name ?? "Object"} ${JSON.stringify(value)}`;
};

/**
 * First difference between two values as "path: actual, JSONModel expected", or "".
 *
 * A key holding undefined counts as absent: JSONModel's merge rebuilds the data and loses
 * such keys (and turns array holes into undefined), SignalModel merges in place and keeps
 * them. Reads cannot tell the two apart.
 */
// oxlint-disable-next-line complexity -- one recursive comparison, clearer in one piece
function difference(actual: unknown, expected: unknown, path = ""): string {
  const isContainer = (v: unknown): v is Record<string, unknown> =>
    (typeof v === "object" || typeof v === "function") && v !== null && !(v instanceof Date);
  if (
    isContainer(actual) &&
    isContainer(expected) &&
    Object.getPrototypeOf(actual) === Object.getPrototypeOf(expected)
  ) {
    for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
      const found = difference(actual[key], expected[key], `${path}/${key}`);
      if (found) return found;
    }
    // JSONModel's merge also drops trailing undefined entries of an array
    const used = (list: unknown): number => {
      let length = (list as unknown[]).length;
      while (length > 0 && (list as unknown[])[length - 1] === undefined) length--;
      return length;
    };
    return Array.isArray(actual) && used(actual) !== used(expected)
      ? `${path}/length: ${used(actual)}, JSONModel ${used(expected)}`
      : "";
  }
  const same =
    actual instanceof Date && expected instanceof Date
      ? actual.getTime() === expected.getTime()
      : Object.is(actual, expected);
  return same ? "" : `${path || "/"}: ${show(actual)}, JSONModel ${show(expected)}`;
}

/** Outcome of a write: accepted, rejected, or thrown (e.g. an invalid array length). */
function attempt(write: () => boolean): string {
  try {
    return write() ? "accepted" : "rejected";
  } catch (error) {
    // JSONModel throws a TypeError where SignalModel returns false: a primitive parent
    return error instanceof TypeError ? "rejected" : (error as Error).name;
  }
}

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function runSeed(seed: number, steps: number): Promise<string> {
  const random = prng(seed);
  const pick = <V>(list: V[]): V => list[Math.floor(random() * list.length)];

  const json = new JSONModel(initialData());
  const signal = new SignalModel<Record<string, unknown>>(initialData());
  const bindings = READ_PATHS.map((path) => signal.bindProperty(path));
  for (const binding of bindings) {
    binding.attachChange(() => {});
    binding.initialize();
  }

  let failure = "";
  for (let step = 0; step < steps && !failure; step++) {
    const kind = random();
    const value = pick(VALUES);
    const path = pick(WRITE_PATHS);
    const async = random() < 0.3;
    let description: string;
    let jsonAccepted: unknown;
    let signalAccepted: unknown;

    if (kind < 0.8) {
      description = `setProperty("${path}", ${show(value())}${async ? ", async" : ""})`;
      jsonAccepted = attempt(() => json.setProperty(path, value(), undefined, async));
      signalAccepted = attempt(() => signal.setProperty(path, value(), undefined, async));
    } else if (kind < 0.9) {
      description = "setData(replace)";
      json.setData(initialData());
      signal.setData(initialData());
    } else {
      const key = path.split("/")[1];
      description = `setData({${key}: ${show(value())}}, merge)`;
      json.setData({ [key]: value() }, true);
      signal.setData({ [key]: value() }, true);
    }

    await Promise.resolve();
    await Promise.resolve();
    await macrotask();
    await macrotask();

    const where = `seed ${seed}, step ${step}: ${description}`;
    if (jsonAccepted !== signalAccepted) {
      failure = `${where}: write ${String(signalAccepted)}, JSONModel ${String(jsonAccepted)}`;
    } else {
      const found = difference(signal.getData(), json.getData());
      if (found) failure = `${where}: data differs at ${found}`;
    }
    for (let i = 0; i < READ_PATHS.length && !failure; i++) {
      // Oracle: JSONModel's data at the path, i.e. what a fresh JSONModel binding shows.
      // (A long-lived JSONModel binding can keep an outdated object that was deep-equal.)
      // An array's length is compared against SignalModel's own array: after a merge the two
      // models' arrays may differ by trailing undefined entries (see difference()).
      const readPath = READ_PATHS[i];
      const arrayPath = readPath.endsWith("/length") ? readPath.slice(0, -"/length".length) : "";
      const ownArray = arrayPath && (signal.getProperty(arrayPath) as unknown);
      const expected = Array.isArray(ownArray)
        ? ownArray.length
        : (json.getProperty(readPath) as unknown);
      const found = difference(bindings[i].getValue(), expected);
      if (found) failure = `${where}: binding ${readPath} differs at ${found}`;
    }
  }

  json.destroy();
  signal.destroy();
  return failure;
}

QUnit.module("Parity fuzz (JSONModel as oracle)", () => {
  for (let seed = 1; seed <= 10; seed++) {
    QUnit.test(`random writes keep data and bindings in parity (seed ${seed})`, async (assert) => {
      assert.strictEqual(await runSeed(seed, 40), "", "no divergence from JSONModel");
    });
  }
});
