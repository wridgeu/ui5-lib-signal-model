import SignalModel from "ui5/model/signal/SignalModel";

/**
 * Tests for destroy edge cases: double destroy, operations after destroy.
 *
 * UI5 lifecycle: after destroy(), ManagedObject sets bDestroyed=true and
 * clears internal state (data, aggregations, bindings). Post-destroy
 * operations are not expected to succeed — the object is dead. These tests
 * verify that post-destroy operations degrade gracefully (no unrecoverable
 * crash) and that the destroyed state is observable.
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

  QUnit.test("getProperty after destroy returns undefined", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    model.destroy();

    // After destroy, ManagedObject clears oData. getProperty returns
    // undefined because the model's internal data is no longer accessible.
    const value = model.getProperty("/name");
    assert.strictEqual(value, undefined, "getProperty returns undefined after destroy");
  });

  QUnit.test("bindProperty after destroy does not throw", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    model.destroy();

    // bindProperty delegates to the UI5 base class. After destroy the
    // model is in an invalid state but binding creation must not crash.
    try {
      model.bindProperty("/name");
      assert.ok(true, "bindProperty did not throw after destroy");
    } catch (e) {
      assert.ok(false, "bindProperty threw after destroy: " + (e as Error).message);
    }
  });

  QUnit.test("bindList after destroy does not throw", (assert) => {
    const model = new SignalModel({ items: [1, 2] });
    model.destroy();

    try {
      model.bindList("/items");
      assert.ok(true, "bindList did not throw after destroy");
    } catch (e) {
      assert.ok(false, "bindList threw after destroy: " + (e as Error).message);
    }
  });

  QUnit.test("setData after destroy does not throw", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    model.destroy();

    // After destroy, setData should not cause an unrecoverable crash.
    // The model is dead — we only verify crash-safety, not functionality.
    try {
      model.setData({ name: "Bob" });
      assert.ok(true, "setData did not throw after destroy");
    } catch (e) {
      assert.ok(false, "setData threw after destroy: " + (e as Error).message);
    }
  });
});
