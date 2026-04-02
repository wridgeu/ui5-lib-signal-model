import SignalModel from "ui5/model/signal/SignalModel";

QUnit.module("SignalPropertyBinding", () => {
  QUnit.test("binding reads initial value from model", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    assert.strictEqual(binding.getValue(), "Alice", "initial value is Alice");
    model.destroy();
  });

  QUnit.test("binding receives push notification on setProperty", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");

    binding.attachChange(() => {
      assert.strictEqual(binding.getValue(), "Bob", "value updated to Bob");
      model.destroy();
      done();
    });

    model.setProperty("/name", "Bob");
  });

  QUnit.test("binding does not fire when value is unchanged", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    let changeCount = 0;

    binding.attachChange(() => {
      changeCount++;
    });

    model.setProperty("/name", "Alice");

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "no change event fired");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("two-way binding: setValue updates model", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");

    binding.setValue("Bob");
    assert.strictEqual(model.getProperty("/name"), "Bob", "model updated via binding");
    model.destroy();
  });

  QUnit.test("multiple bindings to same path both fire", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding1 = model.bindProperty("/name");
    const binding2 = model.bindProperty("/name");
    let count = 0;

    binding1.attachChange(() => count++);
    binding2.attachChange(() => count++);

    model.setProperty("/name", "Bob");

    setTimeout(() => {
      assert.strictEqual(count, 2, "both bindings notified");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("binding to unrelated path does not fire", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice", age: 28 });
    const ageBinding = model.bindProperty("/age");
    let ageChangeCount = 0;

    ageBinding.attachChange(() => ageChangeCount++);

    model.setProperty("/name", "Bob");

    setTimeout(() => {
      assert.strictEqual(ageChangeCount, 0, "age binding not notified");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("suspended binding does not fire", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.suspend();

    model.setProperty("/name", "Bob");

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "no event while suspended");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("resume fires change for pending update", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.suspend();
    model.setProperty("/name", "Bob");

    setTimeout(() => {
      binding.resume();
      setTimeout(() => {
        assert.ok(changeCount > 0, "change fired on resume");
        assert.strictEqual(binding.getValue(), "Bob", "value is current after resume");
        model.destroy();
        done();
      }, 50);
    }, 50);
  });

  QUnit.test("destroy cleans up watcher", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    binding.attachChange(() => {});

    binding.destroy();
    assert.ok(true, "destroy completes without error");
    model.destroy();
  });

  QUnit.test("destroyed binding does not fire after setProperty", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.destroy();

    model.setProperty("/name", "Bob");

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "no change event after destroy");
      model.destroy();
      done();
    }, 50);
  });
});
