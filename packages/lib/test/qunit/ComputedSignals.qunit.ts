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

  // =========================================================================
  // Computed signals with list binding
  // =========================================================================

  QUnit.test("bindList on computed path that returns an array", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [
        { name: "Alice", active: true },
        { name: "Bob", active: false },
        { name: "Carol", active: true },
      ],
    });

    model.createComputed("/activeItems", ["/items"], (items) => {
      return (items as { name: string; active: boolean }[]).filter((i) => i.active);
    });

    const binding = model.bindList("/activeItems");
    let contexts = binding.getContexts(0, 10);
    assert.strictEqual(contexts.length, 2, "computed list has 2 active items");

    binding.attachChange(() => {
      contexts = binding.getContexts(0, 10);
      assert.strictEqual(contexts.length, 3, "computed list updated to 3 active items");
      model.destroy();
      done();
    });

    // Make Bob active — the computed should re-evaluate
    model.setProperty("/items", [
      { name: "Alice", active: true },
      { name: "Bob", active: true },
      { name: "Carol", active: true },
    ]);
  });

  // =========================================================================
  // Computed signals with tree binding
  // =========================================================================

  QUnit.test("bindTree on computed path that returns tree data", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      rawNodes: [{ name: "Parent", children: [{ name: "Child A" }] }, { name: "Leaf" }],
    });

    model.createComputed("/tree", ["/rawNodes"], (nodes) => {
      return (nodes as { name: string }[]).map((n) =>
        Object.assign({}, n, {
          children: (n as Record<string, unknown>).children || [],
        }),
      );
    });

    const binding = model.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);
    let roots = binding.getRootContexts();
    assert.strictEqual(roots.length, 2, "computed tree has 2 root nodes");

    binding.attachChange(() => {
      roots = binding.getRootContexts();
      assert.strictEqual(roots.length, 3, "computed tree updated to 3 roots");
      model.destroy();
      done();
    });

    model.setProperty("/rawNodes", [
      { name: "Parent", children: [{ name: "Child A" }] },
      { name: "Leaf" },
      { name: "New Node" },
    ]);
  });

  // =========================================================================
  // Computed with zero dependencies
  // =========================================================================

  QUnit.test("computed with zero dependencies returns constant value", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ other: "data" });
    model.createComputed("/constant", [], () => 42);

    const binding = model.bindProperty("/constant");
    assert.strictEqual(binding.getValue(), 42, "constant computed returns 42");

    let changeCount = 0;
    binding.attachChange(() => changeCount++);

    // Changing unrelated data should not fire the constant computed
    model.setProperty("/other", "changed");

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "constant computed does not fire on unrelated change");
      assert.strictEqual(binding.getValue(), 42, "value still 42");
      model.destroy();
      done();
    }, 50);
  });

  // =========================================================================
  // getSignal for computed path
  // =========================================================================

  QUnit.test("getSignal returns computed signal and pre-evaluates it", (assert) => {
    const model = new SignalModel({ a: 5 });
    model.createComputed("/doubled", ["/a"], (a) => (a as number) * 2);

    const signal = model.getSignal("/doubled");
    assert.ok(signal, "computed signal returned");
    assert.strictEqual(signal.get(), 10, "computed signal pre-evaluated to 10");
    model.destroy();
  });

  // =========================================================================
  // getSignal for non-existent path
  // =========================================================================

  QUnit.test("getSignal for non-existent path creates state signal with undefined", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const signal = model.getSignal("/nonexistent");
    assert.ok(signal, "signal created on demand");
    assert.strictEqual(signal.get(), undefined, "initial value is undefined");
    model.destroy();
  });

  // =========================================================================
  // getSignal called multiple times returns same instance
  // =========================================================================

  QUnit.test("getSignal returns same instance for same path", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const signal1 = model.getSignal("/name");
    const signal2 = model.getSignal("/name");
    assert.strictEqual(signal1, signal2, "same signal instance returned");
    model.destroy();
  });

  // =========================================================================
  // Computed with dependency that doesn't exist in data
  // =========================================================================

  QUnit.test("computed with missing dependency returns undefined for that dep", (assert) => {
    const model = new SignalModel({});
    model.createComputed("/result", ["/missing"], (val) => (val === undefined ? "default" : val));

    const binding = model.bindProperty("/result");
    assert.strictEqual(
      binding.getValue(),
      "default",
      "missing dep yields undefined, fallback works",
    );
    model.destroy();
  });
});
