import SignalModel from "ui5/model/signal/SignalModel";
import JSONModel from "sap/ui/model/json/JSONModel";

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
    // Merge payload only has 2 items — indices 2 and 3 must survive
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
});
