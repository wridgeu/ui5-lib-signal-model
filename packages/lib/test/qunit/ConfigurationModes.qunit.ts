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

  QUnit.test("default: allows setting existing paths", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const result = model.setProperty("/name", "Bob");
    assert.ok(result, "returns true");
    assert.strictEqual(model.getProperty("/name"), "Bob", "value updated");
    model.destroy();
  });

  // =========================================================================
  // autoCreatePaths: true — extended mode
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

  // =========================================================================
  // strictLeafCheck: true — reject nonexistent leaf properties
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
      assert.notOk(result1, "parent created but leaf rejected by strictLeafCheck");

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
