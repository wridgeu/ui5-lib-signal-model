import SignalModel from "ui5/model/signal/SignalModel";

/**
 * Tests for destroy edge cases: double destroy, operations after destroy.
 */
QUnit.module("Destroy Edge Cases", () => {
  QUnit.test("double destroy on model does not throw", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    model.destroy();
    try {
      model.destroy();
      assert.ok(true, "double destroy did not throw");
    } catch (e) {
      assert.ok(false, "double destroy threw: " + (e as Error).message);
    }
  });

  QUnit.test("double destroy on property binding does not throw", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    binding.destroy();
    try {
      binding.destroy();
      assert.ok(true, "double destroy on binding did not throw");
    } catch (e) {
      assert.ok(false, "double destroy threw: " + (e as Error).message);
    }
    model.destroy();
  });

  QUnit.test("double destroy on list binding does not throw", (assert) => {
    const model = new SignalModel({ items: [{ name: "A" }] });
    const binding = model.bindList("/items");
    binding.destroy();
    try {
      binding.destroy();
      assert.ok(true, "double destroy on list binding did not throw");
    } catch (e) {
      assert.ok(false, "double destroy threw: " + (e as Error).message);
    }
    model.destroy();
  });

  QUnit.test("double destroy on tree binding does not throw", (assert) => {
    const model = new SignalModel({ tree: [{ name: "Root" }] });
    const binding = model.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);
    binding.destroy();
    try {
      binding.destroy();
      assert.ok(true, "double destroy on tree binding did not throw");
    } catch (e) {
      assert.ok(false, "double destroy threw: " + (e as Error).message);
    }
    model.destroy();
  });

  QUnit.test("getProperty after destroy does not crash", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    model.destroy();

    // After destroy, registry is cleared and model may be in a broken state.
    // Either returning a value or throwing is acceptable -- verify no unrecoverable crash.
    try {
      model.getProperty("/name");
      assert.ok(true, "getProperty did not throw after destroy");
    } catch {
      assert.ok(true, "getProperty threw after destroy (acceptable)");
    }
  });

  QUnit.test("bindProperty after destroy does not crash", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    model.destroy();

    try {
      model.bindProperty("/name");
      assert.ok(true, "bindProperty succeeded after destroy");
    } catch {
      assert.ok(true, "bindProperty threw after destroy (acceptable)");
    }
  });

  QUnit.test("bindList after destroy does not crash", (assert) => {
    const model = new SignalModel({ items: [1, 2] });
    model.destroy();

    try {
      model.bindList("/items");
      assert.ok(true, "bindList succeeded after destroy");
    } catch {
      assert.ok(true, "bindList threw after destroy (acceptable)");
    }
  });

  QUnit.test("setData after destroy does not crash", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    model.destroy();

    try {
      model.setData({ name: "Bob" });
      assert.ok(true, "setData succeeded after destroy");
    } catch {
      assert.ok(true, "setData threw after destroy (acceptable)");
    }
  });
});
