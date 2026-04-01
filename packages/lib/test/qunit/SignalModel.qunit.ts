import SignalModel from "ui5/model/signal/SignalModel";

QUnit.module("SignalModel", () => {
  QUnit.test("constructor sets initial data", (assert) => {
    const data = { name: "Alice", age: 28 };
    const model = new SignalModel(data);
    assert.deepEqual(model.getData(), data, "getData returns initial data");
    model.destroy();
  });

  QUnit.test("getProperty returns value at path", (assert) => {
    const model = new SignalModel({ customer: { name: "Alice" } });
    assert.strictEqual(model.getProperty("/customer/name"), "Alice", "nested property");
    model.destroy();
  });

  QUnit.test("getProperty returns undefined for missing path", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    assert.strictEqual(model.getProperty("/missing"), undefined, "undefined for missing");
    model.destroy();
  });

  QUnit.test("setProperty updates data and returns true", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const result = model.setProperty("/name", "Bob");
    assert.ok(result, "returns true on success");
    assert.strictEqual(model.getProperty("/name"), "Bob", "value updated");
    model.destroy();
  });

  QUnit.test("setProperty creates intermediate paths", (assert) => {
    const model = new SignalModel({});
    model.setProperty("/customer/name", "Alice");
    assert.strictEqual(model.getProperty("/customer/name"), "Alice", "created nested path");
    model.destroy();
  });

  QUnit.test("setProperty at root uses setData", (assert) => {
    const model = new SignalModel({ old: true });
    const newData = { new: true };
    model.setProperty("/", newData);
    assert.deepEqual(model.getData(), newData, "root replaced via setData");
    model.destroy();
  });

  QUnit.test("setData replaces all data", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    model.setData({ name: "Bob", extra: true });
    assert.strictEqual(model.getProperty("/name"), "Bob", "data replaced");
    assert.strictEqual(model.getProperty("/extra"), true, "new properties available");
    model.destroy();
  });

  QUnit.test("setData with merge preserves existing properties", (assert) => {
    const model = new SignalModel({ name: "Alice", age: 28 });
    model.setData({ age: 30 }, true);
    assert.strictEqual(model.getProperty("/name"), "Alice", "name preserved");
    assert.strictEqual(model.getProperty("/age"), 30, "age updated");
    model.destroy();
  });

  QUnit.test("setData fires all signals on replace", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice", age: 28 });
    const nameBinding = model.bindProperty("/name");
    const ageBinding = model.bindProperty("/age");
    let nameChanged = false;
    let ageChanged = false;

    nameBinding.attachChange(() => {
      nameChanged = true;
    });
    ageBinding.attachChange(() => {
      ageChanged = true;
    });

    model.setData({ name: "Bob", age: 30 });

    setTimeout(() => {
      assert.ok(nameChanged, "name binding notified");
      assert.ok(ageChanged, "age binding notified");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("setData with merge only fires changed signals", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice", age: 28 });
    const nameBinding = model.bindProperty("/name");
    const ageBinding = model.bindProperty("/age");
    let nameChanged = false;
    let ageChanged = false;

    nameBinding.attachChange(() => {
      nameChanged = true;
    });
    ageBinding.attachChange(() => {
      ageChanged = true;
    });

    model.setData({ age: 30 }, true);

    setTimeout(() => {
      assert.notOk(nameChanged, "name binding NOT notified");
      assert.ok(ageChanged, "age binding notified");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("bindProperty returns a SignalPropertyBinding", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    assert.ok(binding, "binding created");
    assert.strictEqual(binding.getValue(), "Alice", "binding has correct value");
    model.destroy();
  });

  QUnit.test("checkUpdate is a no-op (returns 0)", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const result = model.checkUpdate();
    assert.strictEqual(result, 0, "checkUpdate returns 0");
    model.destroy();
  });

  QUnit.test("getSignal returns the signal for a path", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    model.bindProperty("/name");
    const signal = model.getSignal("/name");
    assert.ok(signal, "signal exists");
    assert.strictEqual(signal.get(), "Alice", "signal has correct value");
    model.destroy();
  });

  QUnit.test("parent path signals fire on leaf write", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ customer: { name: "Alice", age: 28 } });
    const customerBinding = model.bindProperty("/customer");
    let customerChanged = false;

    customerBinding.attachChange(() => {
      customerChanged = true;
    });

    model.setProperty("/customer/name", "Bob");

    setTimeout(() => {
      assert.ok(customerChanged, "parent binding notified on child change");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("branch replace fires all child signals", (assert) => {
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

    model.setProperty("/customer", { name: "Bob", age: 30 });

    setTimeout(() => {
      assert.ok(nameChanged, "name binding notified on branch replace");
      assert.ok(ageChanged, "age binding notified on branch replace");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("destroy cleans up registry", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    model.bindProperty("/name");
    model.destroy();
    assert.ok(true, "destroy completes without error");
  });
});
