import SignalModel from "ui5/model/signal/SignalModel";
import JSONModel from "sap/ui/model/json/JSONModel";
import Context from "sap/ui/model/Context";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import Sorter from "sap/ui/model/Sorter";
import Integer from "sap/ui/model/type/Integer";
import deepEqual from "sap/base/util/deepEqual";
import deepExtend from "sap/base/util/deepExtend";
import nextUIUpdate from "sap/ui/test/utils/nextUIUpdate";
import Input from "sap/m/Input";
import List from "sap/m/List";
import StandardListItem from "sap/m/StandardListItem";
import Text from "sap/m/Text";
import type ListBinding from "sap/ui/model/ListBinding";
import type PropertyBinding from "sap/ui/model/PropertyBinding";
import type TreeBinding from "sap/ui/model/TreeBinding";

/**
 * Differential test: the same random sequence of operations runs against JSONModel and
 * SignalModel, and after every step the two must agree. Compared:
 * - the data, and the result of every write;
 * - property bindings: absolute, relative, switched to another context, suspended;
 * - list bindings: plain, sorted, filtered (test function and operators), extended change
 *   detection, suspended; tree bindings, also with a filter and a sorter;
 * - rendered controls with expression, composite, element, typed, two-way and aggregation
 *   bindings: their properties and their DOM;
 * - computeds, against the same function applied to JSONModel's data.
 * Operations: setProperty (also through a context), a binding's setValue, typing into an
 * input, setData replace and merge, mergeProperty, loadData, setContext, sort, filter,
 * suspend and resume, redefining a computed.
 * The options autoCreatePaths and strictLeafCheck run against JSONModel plus the rule
 * the option adds.
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

/** [context path, path relative to it] for property bindings and for writes */
const RELATIVE_PATHS: [string, string][] = [
  ["/", "n"],
  ["/obj", "v"],
  ["/obj", "nested/v"],
  ["/list", "length"],
  ["/list/0", "name"],
  ["/list/1", "name"],
  ["/s", "length"],
  ["/missing", "x"],
];

/** [path, context path or "", "ecd" (extended change detection), "sorted" or a key of FILTERS] */
const LIST_BINDINGS: [string, string, string][] = [
  ["/list", "", ""],
  ["/list", "", "ecd"],
  ["/list", "", "sorted"],
  ["/list", "", "filtered"],
  ["/list", "", "eq"],
  ["/list", "", "gt"],
  ["/list", "", "contains"],
  ["list", "/", ""],
  ["nested", "/obj", ""],
  ["/obj", "", ""],
  ["/obj", "", "ecd"],
  ["/obj", "", "sorted"],
  ["/", "", ""],
  ["/s", "", ""],
  ["/missing", "", ""],
];

const isContainer = (value: unknown): value is Record<string, unknown> =>
  (typeof value === "object" && value !== null) || typeof value === "function";

const typed = (value: unknown): string => `${typeof value}:${String(value)}`;

/**
 * Computeds on the SignalModel. JSONModel has none, so the expected value is the same
 * function applied to JSONModel's data. The functions accept any value and skip undefined
 * entries, which the two models keep differently after a merge (see difference()).
 */
const COMPUTEDS: [path: string, deps: string[], fn: (...values: unknown[]) => unknown][] = [
  ["/cLabel", ["/s", "/n"], (s, n) => `${typed(s)}|${typed(n)}`],
  [
    "/cObj",
    ["/obj"],
    (obj) => ({
      kind: typeof obj,
      keys: isContainer(obj)
        ? Object.keys(obj)
            .filter((key) => obj[key] !== undefined)
            .toSorted()
            .join(",")
        : "",
      v: isContainer(obj) ? obj.v : undefined,
    }),
  ],
  [
    "/cRows",
    ["/list"],
    (list) =>
      Array.isArray(list)
        ? list.flatMap((item: unknown, i) =>
            item === undefined ? [] : [{ i, name: isContainer(item) ? item.name : item }],
          )
        : [],
  ],
  [
    "/cChain",
    ["/cLabel", "/cRows"],
    (label, rows) => `${(label as string).length}/${(rows as unknown[]).length}`,
  ],
];

/** [computed path, path below it] read through bindings and getProperty */
const COMPUTED_READS: [string, string][] = [
  ["/cLabel", ""],
  ["/cObj", "kind"],
  ["/cObj", "keys"],
  ["/cObj", "v"],
  ["/cRows", "0/name"],
  ["/cRows", "1/i"],
  ["/cRows", "length"],
  ["/cChain", ""],
];

function expectedComputed(path: string, json: JSONModel): unknown {
  const computed = COMPUTEDS.find(([computedPath]) => computedPath === path);
  return computed
    ? computed[2](...computed[1].map((dep) => expectedComputed(dep, json)))
    : (json.getProperty(path) as unknown);
}

type Mode = "default" | "autoCreatePaths" | "strictLeafCheck" | "both options";
type AnyModel = JSONModel | SignalModel<Record<string, unknown>>;

/** What autoCreatePaths adds to JSONModel: objects for missing (null or undefined) parents. */
function createParents(json: JSONModel, path: string): boolean {
  let created = false;
  let current = "";
  for (const part of path.split("/").slice(1, -1)) {
    current += `/${part}`;
    const value = json.getProperty(current) as unknown;
    if (value == null) {
      json.setProperty(current, {});
      created = true;
    } else if (!isContainer(value)) {
      break;
    }
  }
  return created;
}

/**
 * What strictLeafCheck adds to JSONModel: no new property on an existing parent.
 * Checked on SignalModel's data: after a merge only that still has the keys holding
 * undefined (see difference()).
 */
function isNewLeaf(model: AnyModel, path: string): boolean {
  const cut = path.lastIndexOf("/");
  const parent = model.getProperty(path.slice(0, cut) || "/") as unknown;
  return isContainer(parent) && !(path.slice(cut + 1) in parent);
}

/** JSONModel's merge descends only into two arrays or two plain objects. */
function canMerge(target: unknown, payload: unknown): boolean {
  const isPlain = (value: unknown): boolean =>
    isContainer(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  return (Array.isArray(target) && Array.isArray(payload)) || (isPlain(target) && isPlain(payload));
}

/** List filters by name. Operators that need strings throw for other values, in both models. */
const FILTERS: Record<string, () => Filter> = {
  filtered: () => new Filter({ path: "name", test: (name: unknown) => typeof name === "string" }),
  eq: () => new Filter("name", FilterOperator.EQ, "a"),
  gt: () => new Filter("name", FilterOperator.GT, "a"),
  contains: () => new Filter("name", FilterOperator.Contains, "a"),
};

/**
 * Rendered controls with the binding kinds an app uses.
 * `texts` reads the control properties, `rendered` the DOM.
 */
function createControls(model: AnyModel): {
  texts: () => string[];
  rendered: () => string[];
  type: (text: string) => void;
  destroy: () => void;
} {
  const expression = new Text({
    text: "{= ${/n} > 0 ? 'positive' : ${/flag} ? 'flag' : 'other' }",
  });
  const composite = new Text({
    text: {
      parts: [{ path: "/s" }, { path: "/obj/v" }],
      formatter: (s: unknown, v: unknown) => `${typed(s)}|${typeof v}`,
    },
  });
  const element = new Text({ text: { path: "name", formatter: typed } });
  element.bindElement("/list/0");
  const integer = new Text({ text: { path: "/n", type: new Integer() } });
  const input = new Input({ value: { path: "/n", type: new Integer() } });
  const list = new List({
    items: {
      path: "/list",
      template: new StandardListItem({ title: { path: "name", formatter: typed } }),
    },
  });
  const texts = [expression, composite, element, integer];
  // Without rows for undefined entries, and sorted: see listShape()
  const rows = (): StandardListItem[] =>
    (list.getItems() as StandardListItem[]).filter(
      (item) => item.getBindingContext()?.getObject() !== undefined,
    );
  const host = document.body.appendChild(document.createElement("div"));
  for (const control of [...texts, input, list]) {
    control.setModel(model);
    control.placeAt(host);
  }
  return {
    texts: () => [
      ...texts.map((text) => text.getText()),
      input.getValue(),
      rows()
        .map((item) => item.getTitle())
        .toSorted()
        .join(","),
    ],
    rendered: () => [
      ...texts.map((text) => text.getDomRef()?.textContent ?? "not rendered"),
      (input.getFocusDomRef() as HTMLInputElement | null)?.value ?? "not rendered",
      rows()
        .map((item) => item.getDomRef()?.textContent ?? "not rendered")
        .toSorted()
        .join(","),
    ],
    // What typing into the field does: the binding parses the text and writes the model
    type: (text) => input.setValue(text),
    destroy: () => {
      for (const control of [...texts, input, list]) control.destroy();
      host.remove();
    },
  };
}

/** [path, with a filter and a sorter] for tree bindings */
const TREE_BINDINGS: [string, boolean][] = [
  ["/", false],
  ["/obj", false],
  ["/list", false],
  ["/missing", false],
  ["/", true],
  ["/list", true],
];

/** Paths of property bindings that get suspended and resumed */
const SUSPEND_PATHS = ["/s", "/n", "/obj/v", "/list/0/name"];

const TESTDATA = "/test-resources/ui5/model/signal/qunit/testdata";
/** [url, merge] for loadData; the last file does not exist */
const LOADS: [string, boolean][] = [
  [`${TESTDATA}/sample.json`, false],
  [`${TESTDATA}/merge.json`, true],
  [`${TESTDATA}/missing.json`, false],
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
  if (
    isContainer(actual) &&
    isContainer(expected) &&
    !(actual instanceof Date) &&
    !(expected instanceof Date) &&
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

/**
 * Paths of the contexts a list binding returns, or the name of the error it throws.
 * Without undefined entries, and sorted unless `ordered`: after a merge the two models
 * differ in key order and in trailing undefined array entries (see difference()).
 */
function listShape(binding: ListBinding, ordered = false): string {
  try {
    const paths = binding
      .getContexts(0, 100)
      .filter((context) => context.getObject() !== undefined)
      .map((context) => context.getPath());
    return (ordered ? paths : paths.toSorted()).join(" ");
  } catch (error) {
    return (error as Error).name;
  }
}

/**
 * Paths of the first three levels of a tree binding, or the name of the error it throws.
 * Sorted, because the key order differs after a merge (see listShape()).
 */
function treeShape(binding: TreeBinding): string {
  const walk = (contexts: Context[], depth: number): string =>
    contexts
      .map((context) =>
        depth < 2
          ? `${context.getPath()}(${walk(binding.getNodeContexts(context, 0, 100), depth + 1)})`
          : context.getPath(),
      )
      .toSorted()
      .join(" ");
  try {
    return walk(binding.getRootContexts(0, 100), 0);
  } catch (error) {
    return (error as Error).name;
  }
}

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** What a long-lived property binding shows; an object only as its type (see runSeed). */
const shown = (value: unknown): string => (isContainer(value) ? typeof value : typed(value));

/** The first divergence of a seed, with the steps that led to it, or "". */
// oxlint-disable-next-line complexity -- one step loop: operation, wait, comparisons
async function runSeed(seed: number, steps: number, mode: Mode): Promise<string> {
  const random = prng(seed);
  const pick = <V>(list: V[]): V => list[Math.floor(random() * list.length)];
  const autoCreatePaths = mode === "autoCreatePaths" || mode === "both options";
  const strictLeafCheck = mode === "strictLeafCheck" || mode === "both options";

  const json = new JSONModel(initialData());
  const signal = new SignalModel<Record<string, unknown>>(initialData(), {
    autoCreatePaths,
    strictLeafCheck,
  });
  for (const [path, deps, fn] of COMPUTEDS) signal.createComputed(path, deps, fn);

  // UI5's sorter, some filter operators and some types throw for some values (a symbol, an
  // object with a "length" key). JSONModel then skips the bindings it has not updated yet,
  // while SignalModel logs the error and goes on. To keep comparing, JSONModel updates its
  // bindings one by one here as well. The binding that threw is in the same state in both.
  const jsonInternal = json as unknown as {
    checkUpdate: (force?: boolean, async?: boolean) => number;
    getBindings: () => { checkUpdate: (force?: boolean) => void }[];
    bForceUpdate?: boolean;
    sUpdateTimer?: ReturnType<typeof setTimeout> | null;
  };
  const checkUpdate = jsonInternal.checkUpdate;
  jsonInternal.checkUpdate = (force, async) => {
    if (async) return checkUpdate.call(json, force, true);
    const forced = jsonInternal.bForceUpdate || force;
    if (jsonInternal.sUpdateTimer) {
      clearTimeout(jsonInternal.sUpdateTimer);
      jsonInternal.sUpdateTimer = null;
      jsonInternal.bForceUpdate = undefined;
    }
    const all = jsonInternal.getBindings();
    for (const binding of all) {
      try {
        binding.checkUpdate(forced);
      } catch {
        // see above
      }
    }
    return all.length;
  };
  /** Runs an operation on a JSONModel binding and its SignalModel twin; either may throw. */
  const onBoth = <B>(pair: [B, B], operation: (binding: B) => void): void => {
    for (const binding of pair) {
      try {
        operation(binding);
      } catch {
        // see above
      }
    }
  };

  const bindings = READ_PATHS.map((path) => signal.bindProperty(path));
  const relativeContexts = RELATIVE_PATHS.map(([contextPath]) => contextPath);
  const relativeBindings = RELATIVE_PATHS.map(([contextPath, path]) =>
    signal.bindProperty(path, new Context(signal, contextPath)),
  );
  const computedBindings = COMPUTED_READS.map(([path, below], i) =>
    // every second one relative to the computed
    below && i % 2
      ? signal.bindProperty(below, new Context(signal, path))
      : signal.bindProperty(below ? `${path}/${below}` : path),
  );
  const computedList = signal.bindList("/cRows");
  // List, tree and suspended bindings are compared with long-lived JSONModel bindings:
  // like those, a list binding only sorts and filters again once it notices a change.
  const bindLists = (model: AnyModel): ListBinding[] =>
    LIST_BINDINGS.map(([path, contextPath, kind]) => {
      const binding = model.bindList(
        path,
        contextPath ? new Context(model, contextPath) : undefined,
        kind === "sorted" ? new Sorter("name") : undefined,
        FILTERS[kind]?.(),
      );
      if (kind === "ecd") binding.enableExtendedChangeDetection(false, "", {});
      return binding;
    });
  const bindTrees = (model: AnyModel): TreeBinding[] =>
    TREE_BINDINGS.map(([path, filteredAndSorted]) =>
      filteredAndSorted
        ? model.bindTree(
            path,
            undefined,
            [new Filter({ path: "name", test: (name: unknown) => name !== "b" })],
            undefined,
            [new Sorter("name")],
          )
        : model.bindTree(path),
    );
  const bindSuspendable = (model: AnyModel): (PropertyBinding | ListBinding)[] => [
    ...SUSPEND_PATHS.map((path) => model.bindProperty(path)),
    model.bindList("/list"),
  ];
  const listBindings = bindLists(signal);
  const jsonListBindings = bindLists(json);
  const treeBindings = bindTrees(signal);
  const jsonTreeBindings = bindTrees(json);
  const suspendable = bindSuspendable(signal);
  const jsonSuspendable = bindSuspendable(json);
  const suspended = suspendable.map(() => false);
  for (const binding of [
    ...bindings,
    ...relativeBindings,
    ...computedBindings,
    computedList,
    ...listBindings,
    ...jsonListBindings,
    ...treeBindings,
    ...jsonTreeBindings,
    ...suspendable,
    ...jsonSuspendable,
  ]) {
    binding.attachChange(() => {});
    try {
      binding.initialize();
    } catch {
      // see above
    }
  }
  const controls = createControls(signal);
  const jsonControls = createControls(json);

  // Set when JSONModel reached the same data in more steps than SignalModel
  let resync = false;
  /** A write on JSONModel, with the rules of the options under test applied first. */
  const jsonWrite = (path: string, write: () => boolean): string => {
    const created = autoCreatePaths && createParents(json, path);
    if (created) resync = true;
    // A parent that was just created has no properties yet
    if (strictLeafCheck && (created || isNewLeaf(signal, path))) return "rejected";
    return attempt(write);
  };

  let failure = "";
  let descending = false;
  let filterKind = "filtered";
  const history: string[] = [];
  for (let step = 0; step < steps && !failure; step++) {
    const kind = random();
    const value = pick(VALUES);
    const path = pick(WRITE_PATHS);
    const async = random() < 0.3;
    let description: string;
    let jsonAccepted = "";
    let signalAccepted = "";

    if (kind < 0.5) {
      // A quarter of the writes go through a context: "/obj/v" as "v" relative to "/obj"
      const cut = random() < 0.25 ? path.lastIndexOf("/") : 0;
      const contextPath = cut ? path.slice(0, cut) : "";
      const written = cut ? path.slice(cut + 1) : path;
      description = `setProperty("${written}", ${show(value())}${
        contextPath ? `, context ${contextPath}` : ""
      }${async ? ", async" : ""})`;
      const write = (model: AnyModel): boolean =>
        model.setProperty(
          written,
          value(),
          contextPath ? new Context(model, contextPath) : undefined,
          async,
        );
      jsonAccepted = jsonWrite(path, () => write(json));
      signalAccepted = attempt(() => write(signal));
    } else if (kind < 0.57) {
      // What a two-way binding does when the user changes a control
      description = `binding ${path}: setValue(${show(value())})`;
      // setValue writes only a changed value, so the option rules apply only then
      const jsonBinding = json.bindProperty(path);
      if (!deepEqual(jsonBinding.getValue(), value())) {
        jsonWrite(path, () => {
          jsonBinding.setValue(value());
          return true;
        });
      }
      attempt(() => {
        bindings[WRITE_PATHS.indexOf(path)].setValue(value());
        return true;
      });
    } else if (kind < 0.62) {
      const text = pick(["7", "-3", "abc", "", "1.5"]);
      description = `type "${text}" into the input bound to /n`;
      // Not if strictLeafCheck would reject the write: JSONModel cannot show a field
      // whose text did not reach the model
      if (!(strictLeafCheck && isNewLeaf(signal, "/n"))) {
        jsonControls.type(text);
        controls.type(text);
      }
    } else if (kind < 0.68) {
      description = "setData(replace)";
      json.setData(initialData());
      signal.setData(initialData());
    } else if (kind < 0.76) {
      const key = path.split("/")[1];
      description = `setData({${key}: ${show(value())}}, merge)`;
      json.setData({ [key]: value() }, true);
      signal.setData({ [key]: value() }, true);
      resync = true;
    } else if (kind < 0.81) {
      // JSONModel has no mergeProperty: the expected result is its merge applied at the path
      description = `mergeProperty("${path}", ${show(value())})`;
      const existing = json.getProperty(path) as unknown;
      if (canMerge(existing, value())) {
        json.setProperty(
          path,
          deepExtend(Array.isArray(existing) ? [] : {}, existing as object, value() as object),
        );
        jsonAccepted = "accepted";
        resync = true;
      } else {
        jsonAccepted = jsonWrite(path, () => json.setProperty(path, value()));
      }
      signalAccepted = attempt(() => signal.mergeProperty(path, value()));
    } else if (kind < 0.84) {
      const [url, merge] = pick(LOADS);
      description = `loadData(${url.slice(TESTDATA.length)}${merge ? ", merge" : ""})`;
      const outcomes = await Promise.all(
        [json, signal].map((model) =>
          (model.loadData(url, undefined, true, "GET", merge) as Promise<unknown>).then(
            () => "accepted",
            () => "rejected",
          ),
        ),
      );
      [jsonAccepted, signalAccepted] = outcomes;
      resync = true;
    } else if (kind < 0.88) {
      const index = Math.floor(random() * RELATIVE_PATHS.length);
      relativeContexts[index] = pick(RELATIVE_PATHS)[0];
      description = `binding ${RELATIVE_PATHS[index][1]}: setContext(${relativeContexts[index]})`;
      relativeBindings[index].setContext(new Context(signal, relativeContexts[index]));
    } else if (kind < 0.91) {
      descending = !descending;
      description = `sort(${descending ? "descending" : "ascending"})`;
      LIST_BINDINGS.forEach(([, , listKind], i) => {
        if (listKind === "sorted") {
          onBoth([jsonListBindings[i], listBindings[i]], (binding) =>
            // oxlint-disable-next-line unicorn/no-array-sort -- a list binding, not an array
            binding.sort(new Sorter("name", descending)),
          );
        }
      });
    } else if (kind < 0.94) {
      filterKind = pick(Object.keys(FILTERS));
      description = `filter(${filterKind})`;
      const index = LIST_BINDINGS.findIndex(([, , listKind]) => listKind === "filtered");
      onBoth([jsonListBindings[index], listBindings[index]], (binding) =>
        binding.filter(FILTERS[filterKind]()),
      );
    } else if (kind < 0.97) {
      const index = Math.floor(random() * suspendable.length);
      suspended[index] = !suspended[index];
      description = `${suspended[index] ? "suspend" : "resume"} binding ${
        SUSPEND_PATHS[index] ?? "/list (list)"
      }`;
      onBoth([jsonSuspendable[index], suspendable[index]], (binding) =>
        suspended[index] ? binding.suspend() : binding.resume(),
      );
    } else {
      const [computedPath, deps, fn] = pick(COMPUTEDS);
      description = `redefine computed ${computedPath}`;
      signal.removeComputed(computedPath);
      signal.createComputed(computedPath, deps, fn);
    }

    await Promise.resolve();
    await Promise.resolve();
    await macrotask();
    await macrotask();
    if (resync) {
      resync = false;
      // A sorted or filtered binding sorts and filters again only when it notices a change,
      // and what it notices differs here: JSONModel's merge rebuilds the data, so its
      // bindings stop sharing row objects with the model, and the autoCreatePaths rule is
      // applied to JSONModel one parent at a time. Update both sides.
      LIST_BINDINGS.forEach(([, , listKind], i) => {
        if (listKind !== "" && listKind !== "ecd") {
          onBoth([jsonListBindings[i], listBindings[i]], (binding) => binding.refresh(true));
        }
      });
    }
    await nextUIUpdate();

    const where = `${mode} seed ${seed}, step ${step}: ${description}`;
    history.push(description);
    if (jsonAccepted !== signalAccepted) {
      failure = `${where}: write ${signalAccepted}, JSONModel ${jsonAccepted}`;
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
    for (let i = 0; i < RELATIVE_PATHS.length && !failure; i++) {
      const contextPath = relativeContexts[i];
      const relative = RELATIVE_PATHS[i][1];
      // The length of an array: see above
      const ownArray = relative === "length" && (signal.getProperty(contextPath) as unknown);
      const expected = Array.isArray(ownArray)
        ? ownArray.length
        : (json.getProperty(relative, new Context(json, contextPath)) as unknown);
      const found = difference(relativeBindings[i].getValue(), expected);
      if (found) failure = `${where}: binding ${relative} in ${contextPath} differs at ${found}`;
    }
    for (let i = 0; i < COMPUTED_READS.length && !failure; i++) {
      const [computedPath, below] = COMPUTED_READS[i];
      // Read below the computed value as JSONModel reads below data: stop at a falsy value
      const expected = below
        .split("/")
        .reduce<unknown>(
          (node, part) => (part && node ? (node as Record<string, unknown>)[part] : node),
          expectedComputed(computedPath, json),
        );
      const readPath = below ? `${computedPath}/${below}` : computedPath;
      const found =
        difference(computedBindings[i].getValue(), expected) ||
        difference(signal.getProperty(readPath), expected);
      if (found) failure = `${where}: computed ${readPath} differs at ${found}`;
    }
    if (!failure) {
      const actual = listShape(computedList);
      const expected = (expectedComputed("/cRows", json) as unknown[])
        .map((_, i) => `/cRows/${i}`)
        .toSorted()
        .join(" ");
      if (actual !== expected) {
        failure = `${where}: list binding /cRows: [${actual}], expected [${expected}]`;
      }
    }
    for (let i = 0; i < LIST_BINDINGS.length && !failure; i++) {
      const [listPath, contextPath, listKind] = LIST_BINDINGS[i];
      // The order of a sorted object list depends on the key order: see listShape()
      const ordered =
        listKind === "sorted" &&
        Array.isArray(
          signal.getProperty(listPath, contextPath ? new Context(signal, contextPath) : undefined),
        );
      const actual = listShape(listBindings[i], ordered);
      const expected = listShape(jsonListBindings[i], ordered);
      if (actual !== expected) {
        failure = `${where}: list binding ${LIST_BINDINGS[i].join(",")}: [${actual}], JSONModel [${expected}]`;
      }
    }
    for (let i = 0; i < TREE_BINDINGS.length && !failure; i++) {
      const actual = treeShape(treeBindings[i]);
      const expected = treeShape(jsonTreeBindings[i]);
      if (actual !== expected) {
        failure = `${where}: tree binding ${TREE_BINDINGS[i].join(",")}: [${actual}], JSONModel [${expected}]`;
      }
    }
    for (let i = 0; i < suspendable.length && !failure; i++) {
      // Objects by type only: a long-lived JSONModel binding keeps an object that is
      // deep-equal to the new one, which can differ in ways deepEqual does not see.
      const [actual, expected] = [suspendable[i], jsonSuspendable[i]].map((binding) =>
        "getValue" in binding ? shown(binding.getValue()) : listShape(binding as ListBinding),
      );
      if (actual !== expected) {
        failure = `${where}: ${suspended[i] ? "suspended" : "resumed"} binding ${
          SUSPEND_PATHS[i] ?? "/list (list)"
        } shows ${actual}, JSONModel ${expected}`;
      }
    }
    if (!failure && controls.rendered().includes("not rendered")) {
      failure = `${where}: a control has no DOM`;
    }
    for (const read of ["texts", "rendered"] as const) {
      const actual = controls[read]();
      const expected = jsonControls[read]();
      const index = failure ? -1 : actual.findIndex((text, i) => text !== expected[i]);
      if (index !== -1) {
        failure = `${where}: control ${index} ${read}: "${actual[index]}", JSONModel "${expected[index]}"`;
      }
    }
  }

  controls.destroy();
  jsonControls.destroy();
  json.destroy();
  signal.destroy();
  return failure && [failure, "Steps so far:", ...history].join("\n");
}

QUnit.module("Parity fuzz (JSONModel as oracle)", () => {
  // More seeds on demand: open the test page with ?fuzzFrom=11&fuzzCount=25
  const query = new URLSearchParams(location.search);
  const from = Number(query.get("fuzzFrom") ?? 1);
  const count = Number(query.get("fuzzCount") ?? 8);
  const MODES: [Mode, number][] = [
    ["default", count],
    ["autoCreatePaths", Math.ceil(count / 4)],
    ["strictLeafCheck", Math.ceil(count / 4)],
    ["both options", Math.ceil(count / 4)],
  ];
  for (const [mode, seeds] of MODES) {
    for (let seed = from; seed < from + seeds; seed++) {
      QUnit.test(`${mode}: random operations keep parity (seed ${seed})`, async (assert) => {
        assert.strictEqual(await runSeed(seed, 40, mode), "", "no divergence in 40 steps");
      });
    }
  }
});
