import SignalModel from "ui5/model/signal/SignalModel";
import JSONModel from "sap/ui/model/json/JSONModel";

/**
 * strictLeafCheck parity tests: verify that strictLeafCheck does NOT alter
 * setData, getData, or getProperty behavior (those must remain identical to
 * JSONModel). Only setProperty on nonexistent LEAF properties diverges —
 * it returns false instead of creating the property.
 */
QUnit.module("strictLeafCheck JSONModel Parity", () => {
  function assertParity(
    assert: Assert,
    operation: string,
    jsonData: unknown,
    signalData: unknown,
  ): void {
    assert.deepEqual(signalData, jsonData, `${operation}: data matches JSONModel`);
  }

  // =========================================================================
  // setData — behavior MUST be identical regardless of strictLeafCheck
  // =========================================================================

  QUnit.test("setData replace: identical with strictLeafCheck", (assert) => {
    const initial = { name: "Alice", age: 28, items: [1, 2, 3] };
    const replacement = { name: "Bob", role: "admin" };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)), {
      strictLeafCheck: true,
    });

    json.setData(replacement);
    signal.setData(replacement);

    assertParity(assert, "setData replace", json.getData(), signal.getData());
    json.destroy();
    signal.destroy();
  });

  QUnit.test("setData merge: identical with strictLeafCheck", (assert) => {
    const initial = { name: "Alice", age: 28, city: "Berlin" };
    const merge = { age: 30 };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)), {
      strictLeafCheck: true,
    });

    json.setData(merge, true);
    signal.setData(merge, true);

    assertParity(assert, "setData merge", json.getData(), signal.getData());
    json.destroy();
    signal.destroy();
  });

  QUnit.test("setData merge (nested): identical with strictLeafCheck", (assert) => {
    const initial = {
      config: { display: { theme: "dark", fontSize: 14 }, network: { timeout: 5000 } },
    };
    const merge = { config: { display: { fontSize: 16 } } };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)), {
      strictLeafCheck: true,
    });

    json.setData(merge, true);
    signal.setData(merge, true);

    assertParity(assert, "nested merge", json.getData(), signal.getData());
    json.destroy();
    signal.destroy();
  });

  // =========================================================================
  // setProperty on EXISTING paths — must match JSONModel (both succeed)
  // =========================================================================

  QUnit.test("setProperty on existing leaf: identical to JSONModel", (assert) => {
    const initial = { customer: { name: "Alice", address: { city: "Berlin", zip: "10115" } } };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)), {
      strictLeafCheck: true,
    });

    json.setProperty("/customer/name", "Bob");
    signal.setProperty("/customer/name", "Bob");
    assertParity(assert, "setProperty existing leaf", json.getData(), signal.getData());

    json.setProperty("/customer/address", { city: "Munich", zip: "80331" });
    signal.setProperty("/customer/address", { city: "Munich", zip: "80331" });
    assertParity(assert, "setProperty existing object", json.getData(), signal.getData());

    json.destroy();
    signal.destroy();
  });

  QUnit.test("setProperty on nonexistent parent: both return false", (assert) => {
    const json = new JSONModel({});
    const signal = new SignalModel<Record<string, unknown>>({}, { strictLeafCheck: true });

    const jsonResult = json.setProperty("/a/b/c", "deep");
    const signalResult = signal.setProperty("/a/b/c", "deep");

    assert.notOk(jsonResult, "JSONModel returns false");
    assert.notOk(signalResult, "SignalModel returns false");
    assertParity(assert, "nonexistent parent", json.getData(), signal.getData());

    json.destroy();
    signal.destroy();
  });

  // =========================================================================
  // setProperty on NEW LEAF — this is where strictLeafCheck DIVERGES
  // =========================================================================

  QUnit.test("setProperty on new leaf: JSONModel creates, strictLeafCheck rejects", (assert) => {
    const initial = { customer: { name: "Alice" } };

    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)), {
      strictLeafCheck: true,
    });

    const jsonResult = json.setProperty("/customer/email", "alice@example.com");
    const signalResult = signal.setProperty("/customer/email", "alice@example.com");

    assert.ok(jsonResult, "JSONModel creates new leaf (returns true)");
    assert.notOk(signalResult, "strictLeafCheck rejects new leaf (returns false)");

    // Data diverges intentionally here — JSONModel has the property, SignalModel doesn't
    assert.strictEqual(
      json.getProperty("/customer/email"),
      "alice@example.com",
      "JSONModel has the new property",
    );
    assert.strictEqual(
      signal.getProperty("/customer/email"),
      undefined,
      "SignalModel rejected the new property",
    );

    json.destroy();
    signal.destroy();
  });
});
