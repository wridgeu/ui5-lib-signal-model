import SignalModel from "ui5/model/signal/SignalModel";

QUnit.module("StrictMode", () => {
  QUnit.test("strict: false (default) allows setting nonexistent paths", (assert) => {
    const model = new SignalModel({});
    const result = model.setProperty("/newProp", "value");
    assert.ok(result, "returns true");
    assert.strictEqual(model.getProperty("/newProp"), "value", "property created");
    model.destroy();
  });

  QUnit.test("strict: true throws on nonexistent path", (assert) => {
    const model = new SignalModel({}, { strict: true });
    assert.throws(
      () => model.setProperty("/nonexistent", "value"),
      TypeError,
      "throws TypeError for missing path",
    );
    model.destroy();
  });

  QUnit.test("strict: true allows setting existing paths", (assert) => {
    const model = new SignalModel({ name: "Alice" }, { strict: true });
    const result = model.setProperty("/name", "Bob");
    assert.ok(result, "returns true");
    assert.strictEqual(model.getProperty("/name"), "Bob", "value updated");
    model.destroy();
  });

  QUnit.test("strict: true throws on deeply nested nonexistent path", (assert) => {
    const model = new SignalModel({ customer: { name: "Alice" } }, { strict: true });
    assert.throws(
      () => model.setProperty("/customer/email", "alice@example.com"),
      TypeError,
      "throws for missing nested path",
    );
    model.destroy();
  });

  QUnit.test("strict: true allows setting existing nested paths", (assert) => {
    const model = new SignalModel({ customer: { name: "Alice" } }, { strict: true });
    const result = model.setProperty("/customer/name", "Bob");
    assert.ok(result, "returns true");
    assert.strictEqual(model.getProperty("/customer/name"), "Bob", "nested value updated");
    model.destroy();
  });
});
