import SignalModel from "ui5/model/signal/SignalModel";

QUnit.module("Configuration Modes", () => {
  // =========================================================================
  // Default mode: JSONModel parity
  // =========================================================================

  QUnit.test("default: returns false for nonexistent parent path (JSONModel parity)", (assert) => {
    const model = new SignalModel({});
    const result = model.setProperty("/a/b/c", "deep");
    assert.notOk(result, "returns false for nonexistent parent");
    assert.strictEqual(model.getProperty("/a/b/c"), undefined, "path not created");
    model.destroy();
  });

  QUnit.test("default: allows setting new leaf on existing parent (JSONModel parity)", (assert) => {
    const model = new SignalModel({ customer: { name: "Alice" } });
    const result = model.setProperty("/customer/email", "alice@example.com");
    assert.ok(result, "returns true for new leaf on existing parent");
    assert.strictEqual(
      model.getProperty("/customer/email"),
      "alice@example.com",
      "property created",
    );
    model.destroy();
  });

  // =========================================================================
  // autoCreatePaths: true -- extended mode
  // =========================================================================

  QUnit.test("autoCreatePaths: creates intermediate objects for deep paths", (assert) => {
    const model = new SignalModel({}, { autoCreatePaths: true });
    const result = model.setProperty("/a/b/c", "deep");
    assert.ok(result, "returns true");
    assert.strictEqual(model.getProperty("/a/b/c"), "deep", "path auto-created");
    model.destroy();
  });

  QUnit.test("autoCreatePaths: existing paths still work normally", (assert) => {
    const model = new SignalModel({ name: "Alice" }, { autoCreatePaths: true });
    const result = model.setProperty("/name", "Bob");
    assert.ok(result, "returns true");
    assert.strictEqual(model.getProperty("/name"), "Bob", "value updated");
    model.destroy();
  });

  for (const existing of ["Al", "", 0, false]) {
    QUnit.test(`autoCreatePaths: does not replace ${JSON.stringify(existing)}`, (assert) => {
      const model = new SignalModel<Record<string, unknown>>(
        { name: existing },
        { autoCreatePaths: true },
      );
      assert.notOk(model.setProperty("/name/first", "x"), "direct parent: returns false");
      assert.notOk(model.setProperty("/name/a/b", "x"), "further up: returns false");
      assert.strictEqual(model.getProperty("/name"), existing, "value kept");
      model.destroy();
    });
  }

  QUnit.test("autoCreatePaths: does not replace primitive root data", (assert) => {
    const model = new SignalModel<Record<string, unknown>>({}, { autoCreatePaths: true });
    model.setData(0 as never);
    assert.notOk(model.setProperty("/a/b", 1), "returns false");
    assert.strictEqual(model.getData() as unknown, 0, "root data kept");
    model.destroy();
  });

  QUnit.test("autoCreatePaths: creates below null, in root data and below a function", (assert) => {
    const fn = (): number => 1;
    const model = new SignalModel<Record<string, unknown>>(
      { nothing: null, fn },
      { autoCreatePaths: true },
    );
    assert.ok(model.setProperty("/nothing/a/b", 1), "below null: returns true");
    assert.strictEqual(model.getProperty("/nothing/a/b"), 1, "below null: created");
    assert.ok(model.setProperty("/fn/a/b", 2), "below a function: returns true");
    assert.strictEqual(model.getProperty("/fn"), fn, "function kept");
    assert.strictEqual(model.getProperty("/fn/a/b"), 2, "below a function: created");

    const empty = new SignalModel<Record<string, unknown>>({}, { autoCreatePaths: true });
    empty.setData(null as never);
    assert.ok(empty.setProperty("/a/b", 3), "null root data: returns true");
    assert.deepEqual(empty.getData(), { a: { b: 3 } }, "null root data: created");
    model.destroy();
    empty.destroy();
  });

  QUnit.test("autoCreatePaths: bindings below a created object are refreshed", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>(
      { nothing: null },
      { autoCreatePaths: true },
    );
    model.setProperty("/rows", []);
    const length = model.bindProperty("/rows/length");
    length.attachChange(() => {});
    const sibling = model.bindProperty("/nothing/other");
    const rootModel = new SignalModel<Record<string, unknown>>({}, { autoCreatePaths: true });
    rootModel.setData(null as never);
    const belowRoot = rootModel.bindProperty("/other");
    assert.strictEqual(sibling.getValue(), null, "reads the null above it");
    assert.strictEqual(belowRoot.getValue(), null, "reads the null root data");
    sibling.attachChange(() => {});
    belowRoot.attachChange(() => {});

    model.setProperty("/nothing/a/b", 1);
    model.setProperty("/rows/0/name", "x");
    rootModel.setProperty("/a/b", 1);

    setTimeout(() => {
      assert.strictEqual(sibling.getValue(), undefined, "now a missing property");
      assert.strictEqual(length.getValue(), 1, "length of an array that got a new element");
      assert.strictEqual(belowRoot.getValue(), undefined, "now a missing property of the root");
      model.destroy();
      rootModel.destroy();
      done();
    }, 50);
  });

  // =========================================================================
  // strictLeafCheck: true -- reject nonexistent leaf properties
  // =========================================================================

  QUnit.test("strictLeafCheck: returns false for nonexistent leaf on existing parent", (assert) => {
    const model = new SignalModel({ customer: { name: "Alice" } }, { strictLeafCheck: true });
    const result = model.setProperty("/customer/email", "alice@example.com");
    assert.notOk(result, "returns false for missing leaf");
    assert.strictEqual(model.getProperty("/customer/email"), undefined, "property not created");
    model.destroy();
  });

  QUnit.test("strictLeafCheck: allows setting existing leaf properties", (assert) => {
    const model = new SignalModel({ customer: { name: "Alice" } }, { strictLeafCheck: true });
    const result = model.setProperty("/customer/name", "Bob");
    assert.ok(result, "returns true");
    assert.strictEqual(model.getProperty("/customer/name"), "Bob", "value updated");
    model.destroy();
  });

  QUnit.test(
    "strictLeafCheck: returns false for nonexistent parent (default behavior)",
    (assert) => {
      const model = new SignalModel({}, { strictLeafCheck: true });
      const result = model.setProperty("/a/b/c", "deep");
      assert.notOk(result, "returns false for nonexistent parent");
      model.destroy();
    },
  );

  // =========================================================================
  // Both options combined
  // =========================================================================

  QUnit.test(
    "autoCreatePaths + strictLeafCheck: creates parents, rejects unknown leaves",
    (assert) => {
      const model = new SignalModel(
        { existing: { known: "a" } },
        { autoCreatePaths: true, strictLeafCheck: true },
      );

      // autoCreatePaths creates intermediates, but strictLeafCheck still
      // rejects the final leaf if the property doesn't exist on the parent
      const result1 = model.setProperty("/new/path", "value");
      assert.notOk(result1, "leaf rejected by strictLeafCheck");
      assert.deepEqual(model.getProperty("/new"), {}, "parent created without the leaf");

      // Existing leaf on existing parent: allowed
      const result2 = model.setProperty("/existing/known", "updated");
      assert.ok(result2, "existing leaf accepted");

      // New leaf on existing parent: rejected
      const result3 = model.setProperty("/existing/newProp", "value");
      assert.notOk(result3, "new leaf on existing parent rejected");

      model.destroy();
    },
  );
});
