import SignalModel from "ui5/model/signal/SignalModel";
import Log from "sap/base/Log";
import { Signal } from "signal-polyfill";

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
    let nameChanged = 0;
    let ageChanged = 0;

    nameBinding.attachChange(() => {
      nameChanged++;
    });
    ageBinding.attachChange(() => {
      ageChanged++;
    });

    model.mergeProperty("/customer", { age: 30 });

    setTimeout(() => {
      assert.strictEqual(nameChanged, 0, "name binding NOT notified");
      assert.strictEqual(ageChanged, 1, "age binding notified");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("parent signal fires on merge", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ customer: { name: "Alice", age: 28 } });
    const customerBinding = model.bindProperty("/customer");
    let customerChanged = 0;

    customerBinding.attachChange(() => {
      customerChanged++;
    });
    model.mergeProperty("/customer", { age: 30 });

    setTimeout(() => {
      assert.strictEqual(customerChanged, 1, "parent binding notified on merge");
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

  QUnit.test("frozen data that the merge does not write to is left alone", (assert) => {
    const data = { o: { a: 1, f: Object.freeze({ x: 1 }) } };
    const model = new SignalModel(data);
    model.mergeProperty("/o", { a: 2 });
    assert.strictEqual(model.getData(), data, "the data is not rebuilt");
    assert.strictEqual(data.o.a, 2, "merged in place");
    model.destroy();
  });

  QUnit.test("a TypeError that is not a refused write comes out of the merge", (assert) => {
    const data = { a: 1, o: { b: 1 } };
    const model = new SignalModel(data);
    // One watcher per signal: a watcher notifies once until it is armed again
    for (const path of ["/a", "/o/b"]) {
      new Signal.subtle.Watcher(() => {
        throw new TypeError("from a watcher");
      }).watch(model.getSignal(path));
    }
    assert.throws(() => model.setData({ a: 2 }, true), /from a watcher/, "setData with merge");
    assert.throws(() => model.mergeProperty("/o", { b: 2 }), /from a watcher/, "mergeProperty");
    assert.strictEqual(model.getData(), data, "the data is not rebuilt");
    model.destroy();
  });

  QUnit.test("set() on a signal logs a write the model refuses", (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ a: 1 });
    const warnings: string[] = [];
    const original = Log.warning;
    Log.warning = (message: string) => void warnings.push(message);
    (model.getSignal("/missing/x") as Signal.State<unknown>).set(1);
    (model.getSignal("/a") as Signal.State<unknown>).set(2);
    Log.warning = original;
    assert.strictEqual(warnings.length, 1, "one warning, for the refused write");
    assert.ok(warnings[0].includes("/missing/x"), "it names the path");
    assert.strictEqual(model.getProperty("/a"), 2, "the other write went through");
    model.destroy();
  });

  QUnit.test("setData with merge and a payload that is no object", (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ name: "Alice" });
    model.setData(null as never, true);
    model.setData(7 as never, true);
    assert.deepEqual(model.getData(), { name: "Alice" }, "null and a number merge nothing in");
    // as JSONModel: its merge takes the characters as keys
    model.setData("ab" as never, true);
    assert.deepEqual(model.getData(), { 0: "a", 1: "b", name: "Alice" }, "a string");
    model.destroy();
  });
});
