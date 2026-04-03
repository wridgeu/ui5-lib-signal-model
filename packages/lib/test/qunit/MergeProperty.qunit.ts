import SignalModel from "ui5/model/signal/SignalModel";

QUnit.module("mergeProperty", () => {
  QUnit.test("merges into existing object, preserving unchanged fields", (assert) => {
    const model = new SignalModel({ customer: { name: "Alice", age: 28 } });
    const result = model.mergeProperty("/customer", { age: 30 });
    assert.ok(result, "returns true");
    assert.strictEqual(model.getProperty("/customer/name"), "Alice", "name preserved");
    assert.strictEqual(model.getProperty("/customer/age"), 30, "age updated");
    model.destroy();
  });

  QUnit.test("only changed paths fire signals", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ customer: { name: "Alice", age: 28 } });
    const nameBinding = model.bindProperty("/customer/name");
    const ageBinding = model.bindProperty("/customer/age");
    let nameChanged = false;
    let ageChanged = false;

    nameBinding.attachChange(() => {
      nameChanged = true;
    });
    ageBinding.attachChange(() => {
      ageChanged = true;
    });

    model.mergeProperty("/customer", { age: 30 });

    setTimeout(() => {
      assert.notOk(nameChanged, "name binding NOT notified");
      assert.ok(ageChanged, "age binding notified");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("parent signal fires on merge", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ customer: { name: "Alice", age: 28 } });
    const customerBinding = model.bindProperty("/customer");
    let customerChanged = false;

    customerBinding.attachChange(() => {
      customerChanged = true;
    });
    model.mergeProperty("/customer", { age: 30 });

    setTimeout(() => {
      assert.ok(customerChanged, "parent binding notified on merge");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("falls back to setProperty for non-object values", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const result = model.mergeProperty("/name", "Bob");
    assert.ok(result, "returns true");
    assert.strictEqual(model.getProperty("/name"), "Bob", "value replaced");
    model.destroy();
  });

  QUnit.test("mergeProperty at root path merges into model data", (assert) => {
    const model = new SignalModel({ name: "Alice", age: 28 });
    const result = model.mergeProperty("/", { age: 30 });
    assert.ok(result, "returns true for root merge");
    assert.strictEqual(model.getProperty("/name"), "Alice", "name preserved");
    assert.strictEqual(model.getProperty("/age"), 30, "age updated via root merge");
    model.destroy();
  });

  QUnit.test("mergeProperty at root with non-object returns false", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const result = model.mergeProperty("/", "not an object" as any);
    assert.notOk(result, "returns false for non-object root merge");
    assert.strictEqual(model.getProperty("/name"), "Alice", "data unchanged");
    model.destroy();
  });

  QUnit.test("deep merge with nested objects", (assert) => {
    const model = new SignalModel({
      config: {
        display: { theme: "dark", fontSize: 14 },
        network: { timeout: 5000 },
      },
    });

    model.mergeProperty("/config", { display: { fontSize: 16 } });

    assert.strictEqual(model.getProperty("/config/display/theme"), "dark", "theme preserved");
    assert.strictEqual(model.getProperty("/config/display/fontSize"), 16, "fontSize updated");
    assert.strictEqual(model.getProperty("/config/network/timeout"), 5000, "network preserved");
    model.destroy();
  });
});
