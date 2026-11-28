import SignalModel from "ui5/model/signal/SignalModel";
import JSONModel from "sap/ui/model/json/JSONModel";
import Filter from "sap/ui/model/Filter";
import Sorter from "sap/ui/model/Sorter";
import List from "sap/m/List";
import StandardListItem from "sap/m/StandardListItem";
import Text from "sap/m/Text";
import VBox from "sap/m/VBox";

// JSONModel.isList exists at runtime but not in @openui5/types stubs
type JSONModelRuntime = JSONModel & { isList(sPath: string): boolean };

/**
 * Parity tests: run identical operations on both JSONModel and SignalModel
 * (default / non-strict mode), verify that the resulting data is structurally
 * identical. This ensures SignalModel is a true drop-in replacement.
 */
QUnit.module("JSONModel Parity", () => {
  function assertParity(
    assert: Assert,
    operation: string,
    jsonData: unknown,
    signalData: unknown,
  ): void {
    assert.deepEqual(signalData, jsonData, `${operation}: data matches JSONModel`);
  }

  // --- setData replace ---

  QUnit.test("setData replace produces identical data", (assert) => {
    const initial = { name: "Alice", age: 28, items: [1, 2, 3] };
    const replacement = { name: "Bob", role: "admin" };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    json.setData(replacement);
    signal.setData(replacement);

    assertParity(assert, "setData replace", json.getData(), signal.getData());
    json.destroy();
    signal.destroy();
  });

  // --- setData merge (flat) ---

  QUnit.test("setData merge (flat) preserves unmentioned properties", (assert) => {
    const initial = { name: "Alice", age: 28, city: "Berlin" };
    const merge = { age: 30 };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    json.setData(merge, true);
    signal.setData(merge, true);

    assertParity(assert, "flat merge", json.getData(), signal.getData());
    assert.strictEqual(signal.getProperty("/name"), "Alice", "name preserved");
    assert.strictEqual(signal.getProperty("/age"), 30, "age updated");
    assert.strictEqual(signal.getProperty("/city"), "Berlin", "city preserved");
    json.destroy();
    signal.destroy();
  });

  // --- setData merge (nested objects) ---

  QUnit.test("setData merge (nested) deep-merges objects", (assert) => {
    const initial = {
      config: {
        display: { theme: "dark", fontSize: 14 },
        network: { timeout: 5000 },
      },
    };
    const merge = { config: { display: { fontSize: 16 } } };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    json.setData(merge, true);
    signal.setData(merge, true);

    assertParity(assert, "nested merge", json.getData(), signal.getData());
    assert.strictEqual(signal.getProperty("/config/display/theme"), "dark", "theme preserved");
    assert.strictEqual(signal.getProperty("/config/display/fontSize"), 16, "fontSize updated");
    assert.strictEqual(signal.getProperty("/config/network/timeout"), 5000, "network preserved");
    json.destroy();
    signal.destroy();
  });

  // --- setData merge (array by index) ---

  QUnit.test("setData merge (array) merges by index, preserves remaining items", (assert) => {
    const initial = {
      items: [
        { id: 0, value: "a" },
        { id: 1, value: "b" },
        { id: 2, value: "c" },
        { id: 3, value: "d" },
      ],
    };
    // Merge payload only has 2 items -- indices 2 and 3 must survive
    const merge = {
      items: [
        { id: 0, value: "X" },
        { id: 1, value: "Y" },
      ],
    };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    json.setData(merge, true);
    signal.setData(merge, true);

    assertParity(assert, "array merge", json.getData(), signal.getData());
    assert.strictEqual(signal.getProperty("/items/0/value"), "X", "index 0 updated");
    assert.strictEqual(signal.getProperty("/items/1/value"), "Y", "index 1 updated");
    assert.strictEqual(signal.getProperty("/items/2/value"), "c", "index 2 preserved");
    assert.strictEqual(signal.getProperty("/items/3/value"), "d", "index 3 preserved");
    json.destroy();
    signal.destroy();
  });

  // --- setData merge (deeply nested config) ---

  QUnit.test("setData merge (deeply nested) matches JSONModel at all paths", (assert) => {
    const initial = {
      app: {
        display: { theme: "horizon", density: "cozy", language: "en" },
        features: {
          darkMode: false,
          notifications: { email: true, push: false, sms: false },
        },
      },
      user: { name: "Alice", role: "admin" },
    };
    const merge = {
      app: {
        display: { theme: "horizon_dark" },
        features: { notifications: { push: true } },
      },
    };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    json.setData(merge, true);
    signal.setData(merge, true);

    assertParity(assert, "deep nested merge", json.getData(), signal.getData());
    // Changed paths
    assert.strictEqual(signal.getProperty("/app/display/theme"), "horizon_dark", "theme changed");
    assert.strictEqual(
      signal.getProperty("/app/features/notifications/push"),
      true,
      "push changed",
    );
    // Preserved paths
    assert.strictEqual(signal.getProperty("/app/display/density"), "cozy", "density preserved");
    assert.strictEqual(signal.getProperty("/app/display/language"), "en", "language preserved");
    assert.strictEqual(signal.getProperty("/app/features/darkMode"), false, "darkMode preserved");
    assert.strictEqual(
      signal.getProperty("/app/features/notifications/email"),
      true,
      "email preserved",
    );
    assert.strictEqual(signal.getProperty("/user/name"), "Alice", "user preserved");
    json.destroy();
    signal.destroy();
  });

  // --- setProperty ---

  QUnit.test("setProperty at various paths produces identical data", (assert) => {
    const initial = { customer: { name: "Alice", address: { city: "Berlin", zip: "10115" } } };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    json.setProperty("/customer/name", "Bob");
    signal.setProperty("/customer/name", "Bob");
    assertParity(assert, "setProperty leaf", json.getData(), signal.getData());

    json.setProperty("/customer/address", { city: "Munich", zip: "80331" });
    signal.setProperty("/customer/address", { city: "Munich", zip: "80331" });
    assertParity(assert, "setProperty object", json.getData(), signal.getData());

    json.destroy();
    signal.destroy();
  });

  // --- setProperty on nonexistent path: default mode matches JSONModel ---

  QUnit.test("setProperty on nonexistent path: both return false (parity)", (assert) => {
    const json = new JSONModel({});
    const signal = new SignalModel<Record<string, unknown>>({});

    const jsonResult = json.setProperty("/a/b/c", "deep");
    const signalResult = signal.setProperty("/a/b/c", "deep");

    assert.notOk(jsonResult, "JSONModel returns false for nonexistent parent");
    assert.notOk(signalResult, "SignalModel returns false for nonexistent parent");
    assertParity(assert, "nonexistent path", json.getData(), signal.getData());
    json.destroy();
    signal.destroy();
  });

  // --- autoCreatePaths extension ---

  QUnit.test(
    "autoCreatePaths: creates intermediate objects (extension beyond JSONModel)",
    (assert) => {
      const signal = new SignalModel<Record<string, unknown>>({}, { autoCreatePaths: true });
      const result = signal.setProperty("/a/b/c", "deep");

      assert.ok(result, "returns true with autoCreatePaths");
      assert.strictEqual(signal.getProperty("/a/b/c"), "deep", "path auto-created");
      signal.destroy();
    },
  );

  // --- setData merge with type transition (object → primitive) ---

  QUnit.test("setData merge: object replaced by primitive", (assert) => {
    const initial = { data: { nested: { value: 42 } } };
    const merge = { data: { nested: "replaced" } };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    json.setData(merge, true);
    signal.setData(merge, true);

    assertParity(assert, "object→primitive", json.getData(), signal.getData());
    json.destroy();
    signal.destroy();
  });

  // --- setData merge with type transition (primitive → object) ---

  QUnit.test("setData merge: primitive replaced by object", (assert) => {
    const initial = { data: { value: "simple" } };
    const merge = { data: { value: { complex: true, nested: { deep: 1 } } } };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    json.setData(merge, true);
    signal.setData(merge, true);

    assertParity(assert, "primitive→object", json.getData(), signal.getData());
    json.destroy();
    signal.destroy();
  });

  // --- getProperty with context ---

  QUnit.test("getProperty with list context returns same values", (assert) => {
    const initial = {
      items: [
        { name: "Alice", age: 28 },
        { name: "Bob", age: 35 },
      ],
    };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    const jsonContexts = json.bindList("/items").getContexts(0, 10);
    const signalContexts = signal.bindList("/items").getContexts(0, 10);

    for (let i = 0; i < jsonContexts.length; i++) {
      assert.strictEqual(
        signal.getProperty("name", signalContexts[i]),
        json.getProperty("name", jsonContexts[i]),
        `item ${i} name matches`,
      );
      assert.strictEqual(
        signal.getProperty("age", signalContexts[i]),
        json.getProperty("age", jsonContexts[i]),
        `item ${i} age matches`,
      );
    }

    json.destroy();
    signal.destroy();
  });

  // --- isList ---

  QUnit.test("isList returns same result for arrays and non-arrays", (assert) => {
    const initial = { items: [1, 2, 3], name: "Alice", nested: { arr: [] } };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial))) as JSONModelRuntime;
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    assert.strictEqual(signal.isList("/items"), json.isList("/items"), "/items");
    assert.strictEqual(signal.isList("/name"), json.isList("/name"), "/name");
    assert.strictEqual(signal.isList("/nested/arr"), json.isList("/nested/arr"), "/nested/arr");
    assert.strictEqual(signal.isList("/missing"), json.isList("/missing"), "/missing");

    json.destroy();
    signal.destroy();
  });

  // --- Multiple setData merges in sequence ---

  QUnit.test("sequential setData merges accumulate correctly", (assert) => {
    const initial = { a: 1, b: 2, c: 3 };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    json.setData({ a: 10 }, true);
    signal.setData({ a: 10 }, true);
    assertParity(assert, "merge 1", json.getData(), signal.getData());

    json.setData({ b: 20, d: 40 }, true);
    signal.setData({ b: 20, d: 40 }, true);
    assertParity(assert, "merge 2", json.getData(), signal.getData());

    json.setData({ a: 100 }, true);
    signal.setData({ a: 100 }, true);
    assertParity(assert, "merge 3", json.getData(), signal.getData());

    json.destroy();
    signal.destroy();
  });

  // --- getProperty("/") returns root data ---

  QUnit.test("getProperty at root returns same data as getData (parity)", (assert) => {
    const initial = { name: "Alice", age: 28 };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    const jsonRoot = json.getProperty("/");
    const signalRoot = signal.getProperty("/");

    assert.deepEqual(signalRoot, jsonRoot, "getProperty('/') matches JSONModel");
    assert.strictEqual(signalRoot, signal.getData(), "getProperty('/') === getData()");

    json.destroy();
    signal.destroy();
  });

  // --- getJSON / setJSON parity ---

  QUnit.test("getJSON produces same output as JSONModel (parity)", (assert) => {
    const initial = { name: "Alice", items: [1, 2, 3] };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    assert.strictEqual(signal.getJSON(), json.getJSON(), "getJSON matches JSONModel");

    json.destroy();
    signal.destroy();
  });

  QUnit.test("setJSON then getJSON roundtrip matches JSONModel (parity)", (assert) => {
    const jsonStr = '{"name":"Bob","age":30}';

    const json = new JSONModel({});
    const signal = new SignalModel<Record<string, unknown>>({});

    json.setJSON(jsonStr);
    signal.setJSON(jsonStr);

    assertParity(assert, "setJSON roundtrip", json.getData(), signal.getData());
    assert.strictEqual(signal.getJSON(), json.getJSON(), "getJSON matches after setJSON");

    json.destroy();
    signal.destroy();
  });

  // --- checkUpdate(true) forces binding re-evaluation (parity) ---

  QUnit.test("checkUpdate(true) forces all bindings to re-evaluate (parity)", (assert) => {
    const done = assert.async();
    const json = new JSONModel({ name: "Alice" });
    const signal = new SignalModel({ name: "Alice" });

    const jsonBinding = json.bindProperty("/name");
    const signalBinding = signal.bindProperty("/name");
    let jsonCount = 0;
    let signalCount = 0;

    jsonBinding.attachChange(() => jsonCount++);
    signalBinding.attachChange(() => signalCount++);

    // Force update without any data change
    // checkUpdate exists at runtime but not in @openui5/types stubs
    (json as unknown as { checkUpdate(b: boolean): void }).checkUpdate(true);
    signal.checkUpdate(true);

    setTimeout(() => {
      assert.strictEqual(
        signalCount,
        jsonCount,
        "checkUpdate(true) change count matches JSONModel",
      );
      json.destroy();
      signal.destroy();
      done();
    }, 50);
  });

  // --- setData merge with null value in payload (parity) ---

  QUnit.test("setData merge with null value in payload (parity)", (assert) => {
    const initial = { name: "Alice", age: 28, address: { city: "Berlin" } };
    const merge = { address: null };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    json.setData(merge, true);
    signal.setData(merge as Partial<Record<string, unknown>>, true);

    assertParity(assert, "merge with null", json.getData(), signal.getData());
    json.destroy();
    signal.destroy();
  });

  // --- setData merge: array replaced by shorter array (parity) ---

  QUnit.test(
    "setData merge: longer array merged with shorter preserves tail (parity)",
    (assert) => {
      const initial = { items: [1, 2, 3, 4, 5] };
      const merge = { items: [10, 20] };

      const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
      const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

      json.setData(merge, true);
      signal.setData(merge, true);

      assertParity(assert, "shorter array merge", json.getData(), signal.getData());
      json.destroy();
      signal.destroy();
    },
  );

  // --- setProperty returns boolean consistently (parity) ---

  QUnit.test("setProperty return values match JSONModel for various paths", (assert) => {
    const initial = { name: "Alice", nested: { value: 1 } };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    // Existing path
    assert.strictEqual(
      signal.setProperty("/name", "Bob"),
      json.setProperty("/name", "Bob"),
      "existing path: same return value",
    );

    // Nonexistent parent
    assert.strictEqual(
      signal.setProperty("/missing/deep", "x"),
      json.setProperty("/missing/deep", "x"),
      "nonexistent parent: same return value",
    );

    // Root path
    assert.strictEqual(
      signal.setProperty("/nested/value", 2),
      json.setProperty("/nested/value", 2),
      "nested path: same return value",
    );

    json.destroy();
    signal.destroy();
  });

  // --- unbindElement context cleanup (issue #8 parity) ---

  QUnit.test("unbindElement clears stale value -- parity with JSONModel", (assert) => {
    const done = assert.async();
    const jsonModel = new JSONModel({
      data: { level1: { text: "L1" } },
    });
    const signalModel = new SignalModel({
      data: { level1: { text: "L1" } },
    });

    const jsonContainer = new VBox();
    const jsonText = new Text();
    jsonContainer.addItem(jsonText);
    jsonContainer.setModel(jsonModel);
    jsonContainer.placeAt("qunit-fixture");

    const signalContainer = new VBox();
    const signalText = new Text();
    signalContainer.addItem(signalText);
    signalContainer.setModel(signalModel);
    signalContainer.placeAt("qunit-fixture");

    // Set up identical binding contexts + element bindings
    jsonContainer.setBindingContext(jsonModel.createBindingContext("/data")!);
    jsonText.bindElement("level1");
    jsonText.bindProperty("text", "text");

    signalContainer.setBindingContext(signalModel.createBindingContext("/data")!);
    signalText.bindElement("level1");
    signalText.bindProperty("text", "text");

    setTimeout(() => {
      assert.strictEqual(jsonText.getText(), "L1", "JSONModel: initial text");
      assert.strictEqual(signalText.getText(), "L1", "SignalModel: initial text");

      (jsonText as any).unbindElement();
      (signalText as any).unbindElement();

      setTimeout(() => {
        assert.strictEqual(
          signalText.getText(),
          jsonText.getText(),
          "unbindElement result matches JSONModel: " + JSON.stringify(jsonText.getText()),
        );
        jsonContainer.destroy();
        signalContainer.destroy();
        jsonModel.destroy();
        signalModel.destroy();
        done();
      }, 50);
    }, 50);
  });

  QUnit.test("setProperty through a prototype path -- refused, unlike JSONModel", (assert) => {
    // JSONModel writes through "__proto__" and "constructor/prototype" to Object.prototype.
    // SignalModel refuses (a documented difference). This pins both sides.
    const probe = Object.prototype as Record<string, unknown>;
    const run = (model: JSONModel | SignalModel<Record<string, unknown>>) => {
      const result: unknown[] = [];
      try {
        result.push(model.setProperty("/__proto__/parityProbeA", 1), probe.parityProbeA);
        result.push(
          model.setProperty("/constructor/prototype/parityProbeB", 2),
          probe.parityProbeB,
        );
      } finally {
        delete probe.parityProbeA;
        delete probe.parityProbeB;
      }
      model.destroy();
      return result;
    };

    const json = run(new JSONModel({}));
    const signal = run(new SignalModel<Record<string, unknown>>({}));

    assert.deepEqual(json, [true, 1, true, 2], "JSONModel writes through the prototype path");
    assert.deepEqual(signal, [false, undefined, false, undefined], "SignalModel refuses");
    assert.strictEqual(probe.parityProbeA, undefined, "Object.prototype cleaned up");
    assert.strictEqual(probe.parityProbeB, undefined, "Object.prototype cleaned up");
  });

  // A binding must show what JSONModel holds at its path after the write.
  type AnyModel = JSONModel | SignalModel<Record<string, unknown>>;
  const DERIVED_VALUE_CASES: {
    name: string;
    data: () => object;
    path: string;
    write: (model: AnyModel) => void;
    expected: unknown;
  }[] = [
    {
      name: "binding below a primitive follows a write to it",
      data: () => ({ name: "Al" }),
      path: "/name/length",
      write: (model) => model.setProperty("/name", "Alice"),
      expected: 5,
    },
    {
      name: "binding below a primitive follows a bAsyncUpdate write to it",
      data: () => ({ name: "Al" }),
      path: "/name/length",
      write: (model) => model.setProperty("/name", "Alice", undefined, true),
      expected: 5,
    },
    {
      name: "array length follows a write to an element",
      data: () => ({ list: [1, 2] }),
      path: "/list/length",
      write: (model) => model.setProperty("/list/3", 9),
      expected: 4,
    },
    {
      name: "array length follows a bAsyncUpdate write to an element",
      data: () => ({ list: [1, 2] }),
      path: "/list/length",
      write: (model) => model.setProperty("/list/3", 9, undefined, true),
      expected: 4,
    },
    {
      name: "array element follows a write to the length",
      data: () => ({ list: [1, 2, 3] }),
      path: "/list/2",
      write: (model) => model.setProperty("/list/length", 1),
      expected: undefined,
    },
    {
      name: "array length follows a merge that appends",
      data: () => ({ list: [1] }),
      path: "/list/length",
      write: (model) => model.setData({ list: [1, 2, 3] }, true),
      expected: 3,
    },
    {
      name: "length of a root array follows a write to an element",
      data: () => [1, 2],
      path: "/length",
      write: (model) => model.setProperty("/2", 9),
      expected: 3,
    },
    {
      name: "a write below a function is stored on the function",
      data: () => ({ fn: () => 1 }),
      path: "/fn/x",
      write: (model) => model.setProperty("/fn/x", 1),
      expected: 1,
    },
    {
      name: "element of a root array follows a write to the length",
      data: () => [1, 2, 3],
      path: "/2",
      write: (model) => model.setProperty("/length", 1),
      expected: undefined,
    },
    {
      name: "element of a root array follows a bAsyncUpdate write to the length",
      data: () => [1, 2, 3],
      path: "/2",
      write: (model) => model.setProperty("/length", 1, undefined, true),
      expected: undefined,
    },
    {
      name: "reading below a falsy value returns that value",
      data: () => ({ count: 0 }),
      path: "/count/x",
      write: () => {},
      expected: 0,
    },
    {
      name: "merging undefined keeps the existing value",
      data: () => ({ s: "keep" }),
      path: "/s",
      write: (model) => model.setData({ s: undefined }, true),
      expected: "keep",
    },
    {
      name: "merging a Date over an object replaces the object",
      data: () => ({ obj: { v: 1 } }),
      path: "/obj/v",
      write: (model) => model.setData({ obj: new Date(0) }, true),
      expected: undefined,
    },
  ];

  for (const { name, data, path, write, expected } of DERIVED_VALUE_CASES) {
    QUnit.test(`${name} -- parity with JSONModel`, (assert) => {
      const done = assert.async();
      const json = new JSONModel(data());
      const signal = new SignalModel<Record<string, unknown>>(data() as Record<string, unknown>);
      const binding = signal.bindProperty(path);
      binding.attachChange(() => {});

      write(json);
      write(signal);

      setTimeout(() => {
        assert.strictEqual(json.getProperty(path), expected, "JSONModel holds the expected value");
        assert.strictEqual(binding.getValue(), expected, "SignalModel binding shows it");
        assert.strictEqual(
          signal.getProperty(path),
          expected,
          "SignalModel getProperty returns it",
        );
        json.destroy();
        signal.destroy();
        done();
      }, 50);
    });
  }

  QUnit.test(
    "reading below a falsy value with a computed registered returns that value",
    (assert) => {
      const model = new SignalModel<Record<string, unknown>>({ count: 0 });
      model.createComputed("/double", ["/count"], (count) => (count as number) * 2);
      assert.strictEqual(model.getProperty("/count/x"), 0, "the falsy value itself");
      model.destroy();
    },
  );

  QUnit.test(
    "reading below a falsy value in a raw-object context -- parity with JSONModel",
    (assert) => {
      const json = new JSONModel({});
      const signal = new SignalModel<Record<string, unknown>>({});
      const raw = { count: 0 } as never;
      assert.strictEqual(json.getProperty("count/x", raw), 0, "JSONModel returns the falsy value");
      assert.strictEqual(signal.getProperty("count/x", raw), 0, "SignalModel returns it too");
      json.destroy();
      signal.destroy();
    },
  );

  // A binding on an object is notified once when something below it is written.
  const ANCESTOR_CASES: [bound: string, written: string, value: unknown, async: boolean][] = [
    ["/", "/a", 2, false],
    ["/", "/a", 2, true],
    ["/items", "/items/0", { name: "y" }, false],
    ["/items", "/items/0", { name: "y" }, true],
  ];
  for (const [bound, written, value, async] of ANCESTOR_CASES) {
    QUnit.test(
      `binding ${bound} fires once for a${async ? " bAsyncUpdate" : ""} write to ${written}`,
      (assert) => {
        const done = assert.async();
        const model = new SignalModel<Record<string, unknown>>({ a: 1, items: [{ name: "x" }] });
        const binding = model.bindProperty(bound);
        let changeCount = 0;
        binding.attachChange(() => changeCount++);

        model.setProperty(written, value, undefined, async);

        setTimeout(() => {
          assert.strictEqual(changeCount, 1, "one change event");
          model.destroy();
          done();
        }, 50);
      },
    );
  }

  // The list re-uses the item of row 1 for row 0. The update queued for its old row
  // must not be applied to it afterwards.
  QUnit.test("a list item moved to another row shows that row -- parity", (assert) => {
    const done = assert.async();
    const titles = [new JSONModel({}), new SignalModel<Record<string, unknown>>({})].map(
      (model) => {
        model.setData({ list: { 1: { name: "x" } } });
        const list = new List({
          items: { path: "/list", template: new StandardListItem({ title: "{name}" }) },
        });
        list.setModel(model);
        model.setData({ list: [{ name: "a" }, { name: "b" }] });
        return (): string => {
          const result = list.getItems().map((item) => (item as StandardListItem).getTitle());
          list.destroy();
          model.destroy();
          return result.join(",");
        };
      },
    );
    setTimeout(() => {
      assert.strictEqual(titles[0](), "a,b", "JSONModel");
      assert.strictEqual(titles[1](), "a,b", "SignalModel");
      done();
    }, 50);
  });

  QUnit.test("a sorter reads falsy list items like JSONModel", (assert) => {
    const order = (model: JSONModel | SignalModel<Record<string, unknown>>): string =>
      model
        .bindList("/list", undefined, new Sorter("name"))
        .getContexts()
        .map((context) => context.getPath())
        .join(" ");
    const data = (): Record<string, unknown> => ({ list: [{ name: "b" }, "", 0, { name: "a" }] });
    const json = new JSONModel(data());
    const signal = new SignalModel(data());
    assert.strictEqual(order(signal), order(json), "same order");
    json.destroy();
    signal.destroy();
  });

  QUnit.test("a list binding over an object skips undefined values like JSONModel", (assert) => {
    for (const model of [new JSONModel({}), new SignalModel<Record<string, unknown>>({})]) {
      model.setData({ obj: { a: 1, b: undefined } });
      const paths = model
        .bindList("/obj")
        .getContexts()
        .map((context) => context.getPath());
      const name = model instanceof JSONModel ? "JSONModel" : "SignalModel";
      assert.deepEqual(paths, ["/obj/a"], `${name}: only the key with a value`);
      model.destroy();
    }
  });

  QUnit.test("a merge copies the payload -- parity with JSONModel", (assert) => {
    for (const model of [new JSONModel({}), new SignalModel<Record<string, unknown>>({})]) {
      const payload = { obj: { v: 1 }, list: [{ v: 1 }] };
      model.setData(payload, true);
      payload.obj.v = 2;
      payload.list[0].v = 2;
      const name = model instanceof JSONModel ? "JSONModel" : "SignalModel";
      assert.strictEqual(model.getProperty("/obj/v"), 1, `${name}: object was copied`);
      assert.strictEqual(model.getProperty("/list/0/v"), 1, `${name}: array was copied`);
      model.destroy();
    }
  });
  const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  QUnit.test(
    "after a merge a list fires for a changed row only, like JSONModel",
    async (assert) => {
      for (const model of [new JSONModel({}), new SignalModel<Record<string, unknown>>({})]) {
        const name = model instanceof JSONModel ? "JSONModel" : "SignalModel";
        model.setData({ list: [{ name: "a" }, { name: "b" }], other: 1 });
        const binding = model.bindList("/list");
        let fired = 0;
        binding.attachChange(() => fired++);
        binding.initialize();
        fired = 0;

        model.setData({ other: 2 }, true);
        model.setProperty("/list/0/name", "a");
        await settled();
        assert.strictEqual(fired, 0, `${name}: not for a write of the same value`);

        model.setData({ list: [{ name: "c" }] }, true);
        await settled();
        assert.strictEqual(fired, 1, `${name}: for a merge that changes a row`);

        model.setData({ other: 3 }, true);
        model.setProperty("/list/1/name", "b");
        await settled();
        assert.strictEqual(fired, 1, `${name}: not for the same value after the next merge`);
        model.destroy();
      }
    },
  );

  QUnit.test(
    "a merge below a row does not make the list fire after a later merge",
    async (assert) => {
      const model = new SignalModel<Record<string, unknown>>({ list: [{ nested: { v: 1 } }] });
      const binding = model.bindList("/list");
      let fired = 0;
      binding.attachChange(() => fired++);
      binding.initialize();
      model.mergeProperty("/list/0/nested", { v: 2 });
      await settled();
      fired = 0;

      model.setData({ other: 2 }, true);
      model.setProperty("/list/0/nested/v", 2);
      await settled();
      assert.strictEqual(fired, 0);
      model.destroy();
    },
  );

  QUnit.test("a sorted list notices a merge like JSONModel", async (assert) => {
    for (const model of [new JSONModel({}), new SignalModel<Record<string, unknown>>({})]) {
      const name = model instanceof JSONModel ? "JSONModel" : "SignalModel";
      model.setData({ list: [{ name: "a" }, { name: "b" }], other: 1 });
      const binding = model.bindList("/list", undefined, new Sorter("name"));
      let fired = 0;
      binding.attachChange(() => fired++);
      binding.initialize();
      fired = 0;
      const order = (): string =>
        binding
          .getContexts()
          .map((context) => context.getPath())
          .join(" ");

      model.setProperty("/list/0/name", "z");
      await settled();
      assert.strictEqual(
        `${order()}, ${fired}`,
        "/list/0 /list/1, 0",
        `${name}: not after a write`,
      );

      model.setData({ list: [{ name: "c" }] }, true);
      await settled();
      assert.strictEqual(`${order()}, ${fired}`, "/list/1 /list/0, 1", `${name}: after a merge`);

      // JSONModel's merge rebuilds the data, so the binding's rows are no longer the model's
      model.setData({ other: 2 }, true);
      model.setProperty("/list/1/name", "a");
      await settled();
      assert.strictEqual(
        `${order()}, ${fired}`,
        "/list/1 /list/0, 2",
        `${name}: after the next write to a row`,
      );

      model.setProperty("/list/1/name", "d");
      await settled();
      assert.strictEqual(`${order()}, ${fired}`, "/list/1 /list/0, 2", `${name}: not after that`);

      // After a merge and new data with the same content, the binding still holds the rows
      // from before, so the next write to a row is noticed
      model.setData({ other: 3 }, true);
      model.setData({ list: [{ name: "c" }, { name: "d" }], other: 3 });
      await settled();
      assert.strictEqual(fired, 2, `${name}: not for the same content`);
      model.setProperty("/list/0/name", "b");
      await settled();
      assert.strictEqual(
        `${order()}, ${fired}`,
        "/list/0 /list/1, 3",
        `${name}: after new data with the same content`,
      );

      // With the row itself as key, the change detection compares the row objects
      const detecting = model.bindList("/list");
      detecting.enableExtendedChangeDetection(false, "", {});
      let detected = 0;
      detecting.attachChange(() => detected++);
      detecting.initialize();
      detecting.getContexts(0, 10);
      detected = 0;
      model.setProperty("/list/0/name", "x");
      await settled();
      model.setData({ list: [{ name: "y" }] }, true);
      await settled();
      assert.strictEqual(detected, 1, `${name}: with change detection, only after the merge`);
      detecting.getContexts(0, 10);
      model.setProperty("/list/0/name", "x");
      await settled();
      assert.strictEqual(detected, 1, `${name}: with change detection, not after the next write`);

      // With bDetectUpdates the row data is compared, for the rows that were read
      const comparing = model.bindList("/list");
      comparing.enableExtendedChangeDetection(true, "", {});
      let compared = 0;
      comparing.attachChange(() => compared++);
      comparing.initialize();
      comparing.getContexts(0, 1);
      compared = 0;
      model.setData({ list: [{}, { name: "w" }] }, true);
      await settled();
      assert.strictEqual(compared, 0, `${name}: no change in the rows that were read`);

      // What controls use: no key, so the data of the rows that were read is compared.
      // With a key property, the keys are.
      for (const key of [undefined, "id"]) {
        model.setData({
          list: [
            { id: 1, name: "a" },
            { id: 2, name: "b" },
          ],
        });
        const keyed = model.bindList("/list");
        keyed.enableExtendedChangeDetection(false, key as string, {});
        let count = 0;
        keyed.attachChange(() => count++);
        keyed.initialize();
        keyed.getContexts(0, 1);
        count = 0;
        model.setData({ list: [{}, { name: "w" }] }, true);
        await settled();
        assert.strictEqual(count, 0, `${name}, key ${key}: merge changed a row that was not read`);
        model.setData({ list: [{ name: "v" }] }, true);
        await settled();
        assert.strictEqual(
          count,
          key ? 0 : 1,
          `${name}, key ${key}: merge changed a row that was read`,
        );
        keyed.destroy();
      }

      // A filter with only a test function gets the row
      const filtered = model.bindList("/list", undefined, undefined, [
        new Filter({ test: (row: { id: number }) => row.id === 2 } as never),
      ]);
      filtered.initialize();
      assert.strictEqual(
        filtered
          .getContexts(0, 10)
          .map((context) => context.getPath())
          .join(),
        "/list/1",
        `${name}: filter without a path`,
      );

      model.destroy();
    }
  });
  QUnit.test(
    "a sorted list notices mergeProperty on a row, on the list and above it",
    async (assert) => {
      const model = new SignalModel<Record<string, unknown>>({
        data: { list: [{ name: "a", sub: {} }, { name: "b" }] },
        other: {},
      });
      const binding = model.bindList("/data/list", undefined, new Sorter("name"));
      binding.attachChange(() => {});
      binding.initialize();
      const merges: [string, unknown, string][] = [
        ["/data/list/0", { name: "c" }, "/data/list/1 /data/list/0"],
        ["/data/list", [{ name: "a" }], "/data/list/0 /data/list/1"],
        ["/data", { list: [{ name: "c" }] }, "/data/list/1 /data/list/0"],
        // Elsewhere or below a row: the write to a row is not noticed, as without a merge
        ["/other", { list: [{ name: "a" }] }, "/data/list/1 /data/list/0"],
        ["/data/list/0/sub", { x: 1 }, "/data/list/1 /data/list/0"],
      ];
      for (const [path, payload, expected] of merges) {
        model.mergeProperty(path, payload);
        if (path === "/other") model.setProperty("/data/list/0/name", "a");
        await settled();
        const order = binding
          .getContexts()
          .map((context) => context.getPath())
          .join(" ");
        assert.strictEqual(order, expected, `after a merge at ${path}`);
      }
      binding.destroy();

      // With change detection a merge counts only for the update that follows it
      const detecting = model.bindList("/data/list");
      detecting.enableExtendedChangeDetection(false, "", {});
      let detected = 0;
      detecting.attachChange(() => detected++);
      detecting.initialize();
      detecting.getContexts(0, 10);
      detected = 0;
      model.setData({ other: { y: 1 } }, true);
      await settled();
      model.setProperty("/data/list/0/name", "q");
      await settled();
      assert.strictEqual(detected, 0, "no late change event for a merge elsewhere");
      detecting.destroy();
      assert.strictEqual(model._listBindings.size, 0, "a destroyed binding is forgotten");
      model.destroy();
    },
  );
  QUnit.test("a binding shows what the model holds after setValue -- parity", async (assert) => {
    for (const model of [new JSONModel({}), new SignalModel<Record<string, unknown>>({})]) {
      const name = model instanceof JSONModel ? "JSONModel" : "SignalModel";
      model.setData({ list: [] });
      const binding = model.bindProperty("/list/length");
      binding.attachChange(() => {});
      binding.initialize();
      // An array turns the text into a number, here the one it already had
      binding.setValue("");
      await settled();
      assert.strictEqual(binding.getValue(), 0, `${name}: the length, not the text`);
      model.destroy();
    }
  });
});
