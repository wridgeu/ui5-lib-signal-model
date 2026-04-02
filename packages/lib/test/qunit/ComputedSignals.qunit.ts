import SignalModel from "ui5/model/signal/SignalModel";

QUnit.module("ComputedSignals", () => {
  QUnit.test("createComputed creates a derived value", (assert) => {
    const model = new SignalModel({ firstName: "Alice", lastName: "Smith" });
    model.createComputed("/fullName", ["/firstName", "/lastName"], (first, last) => {
      return `${first} ${last}`;
    });
    const binding = model.bindProperty("/fullName");
    assert.strictEqual(binding.getValue(), "Alice Smith", "computed value correct");
    model.destroy();
  });

  QUnit.test("computed updates when dependency changes", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ firstName: "Alice", lastName: "Smith" });
    model.createComputed("/fullName", ["/firstName", "/lastName"], (first, last) => {
      return `${first} ${last}`;
    });
    const binding = model.bindProperty("/fullName");
    binding.attachChange(() => {
      assert.strictEqual(binding.getValue(), "Bob Smith", "computed updated");
      model.destroy();
      done();
    });
    model.setProperty("/firstName", "Bob");
  });

  QUnit.test("setProperty on computed path throws", (assert) => {
    const model = new SignalModel({ a: 1 });
    model.createComputed("/doubled", ["/a"], (a) => (a as number) * 2);
    assert.throws(
      () => model.setProperty("/doubled", 99),
      TypeError,
      "throws TypeError on write to computed",
    );
    model.destroy();
  });

  QUnit.test("createComputed on raw data path throws", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    model.bindProperty("/name");
    assert.throws(
      () => model.createComputed("/name", [], () => "x"),
      TypeError,
      "throws when path has raw data",
    );
    model.destroy();
  });

  QUnit.test("createComputed on existing computed throws", (assert) => {
    const model = new SignalModel({ a: 5 });
    model.createComputed("/result", ["/a"], (a) => (a as number) + 10);
    assert.throws(
      () => model.createComputed("/result", ["/a"], (a) => (a as number) * 2),
      TypeError,
      "throws when computed already exists",
    );
    model.destroy();
  });

  QUnit.test("removeComputed then createComputed redefines the derivation", (assert) => {
    const model = new SignalModel({ a: 5 });
    model.createComputed("/result", ["/a"], (a) => (a as number) + 10);
    assert.strictEqual(model.bindProperty("/result").getValue(), 15, "first computed");

    model.removeComputed("/result");
    model.createComputed("/result", ["/a"], (a) => (a as number) * 2);
    assert.strictEqual(model.bindProperty("/result").getValue(), 10, "redefined computed");
    model.destroy();
  });

  QUnit.test("removeComputed removes the computed signal", (assert) => {
    const model = new SignalModel({ a: 1 });
    model.createComputed("/doubled", ["/a"], (a) => (a as number) * 2);
    model.removeComputed("/doubled");
    const binding = model.bindProperty("/doubled");
    assert.strictEqual(binding.getValue(), undefined, "computed removed, returns undefined");
    model.destroy();
  });

  QUnit.test("chained computed: computed depending on another computed", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ a: 5 });
    model.createComputed("/double", ["/a"], (a) => (a as number) * 2);
    model.createComputed("/quad", ["/double"], (d) => (d as number) * 2);

    const doubleBinding = model.bindProperty("/double");
    const quadBinding = model.bindProperty("/quad");
    assert.strictEqual(doubleBinding.getValue(), 10, "double = 5 * 2 = 10");
    assert.strictEqual(quadBinding.getValue(), 20, "quad = 10 * 2 = 20");

    quadBinding.attachChange(() => {
      assert.strictEqual(doubleBinding.getValue(), 14, "double updated to 7 * 2 = 14");
      assert.strictEqual(quadBinding.getValue(), 28, "quad updated to 14 * 2 = 28");
      model.destroy();
      done();
    });

    model.setProperty("/a", 7);
  });

  QUnit.test(
    "existing binding updates after removeComputed + createComputed (same deps)",
    (assert) => {
      const done = assert.async();
      const model = new SignalModel({ a: 5 });
      model.createComputed("/result", ["/a"], (a) => (a as number) + 10);

      // Simulate an XML view binding that was created before the redefine
      const binding = model.bindProperty("/result");
      assert.strictEqual(binding.getValue(), 15, "binding reads original computed");

      // Redefine: remove + recreate with same dependencies
      model.removeComputed("/result");
      model.createComputed("/result", ["/a"], (a) => (a as number) * 3);

      // Trigger a dependency change — binding should see the new formula
      binding.attachChange(() => {
        assert.strictEqual(binding.getValue(), 21, "binding sees new computed (7 * 3 = 21)");
        model.destroy();
        done();
      });

      model.setProperty("/a", 7);
    },
  );

  QUnit.test(
    "existing binding updates after removeComputed + createComputed (different deps)",
    (assert) => {
      const done = assert.async();
      const model = new SignalModel({ a: 5, b: 100 });
      model.createComputed("/result", ["/a"], (a) => (a as number) + 10);

      const binding = model.bindProperty("/result");
      assert.strictEqual(binding.getValue(), 15, "binding reads original computed");

      // Redefine with DIFFERENT dependencies — the real test.
      // Without re-subscribe, changing /b would never fire the old watcher.
      model.removeComputed("/result");
      model.createComputed("/result", ["/b"], (b) => (b as number) * 2);

      binding.attachChange(() => {
        assert.strictEqual(binding.getValue(), 400, "binding sees new computed (200 * 2 = 400)");
        model.destroy();
        done();
      });

      // Change the NEW dependency — binding must update
      model.setProperty("/b", 200);
    },
  );

  QUnit.test("computed with multiple dependencies", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ price: 100, tax: 0.2 });
    model.createComputed("/total", ["/price", "/tax"], (price, tax) => {
      return (price as number) * (1 + (tax as number));
    });
    const binding = model.bindProperty("/total");
    assert.strictEqual(binding.getValue(), 120, "initial total correct");
    binding.attachChange(() => {
      assert.strictEqual(binding.getValue(), 240, "total updated when price changes");
      model.destroy();
      done();
    });
    model.setProperty("/price", 200);
  });
});
