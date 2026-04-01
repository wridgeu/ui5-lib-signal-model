import { Signal } from "signal-polyfill";
import SignalRegistry from "ui5/model/signal/SignalRegistry";

QUnit.module("SignalRegistry", () => {
  QUnit.test("getOrCreate creates a Signal.State with initial value", (assert) => {
    const registry = new SignalRegistry();
    const signal = registry.getOrCreate("/name", "Alice");
    assert.ok(signal, "signal is created");
    assert.strictEqual(signal.get(), "Alice", "initial value is 'Alice'");
    registry.destroy();
  });

  QUnit.test("getOrCreate returns same signal for same path", (assert) => {
    const registry = new SignalRegistry();
    const signal1 = registry.getOrCreate("/name", "Alice");
    const signal2 = registry.getOrCreate("/name", "Bob");
    assert.strictEqual(signal1, signal2, "same instance returned");
    assert.strictEqual(signal1.get(), "Alice", "initial value preserved");
    registry.destroy();
  });

  QUnit.test("get returns undefined for unknown path", (assert) => {
    const registry = new SignalRegistry();
    assert.strictEqual(registry.get("/unknown"), undefined, "undefined for unknown");
    registry.destroy();
  });

  QUnit.test("has returns false for unknown, true for known path", (assert) => {
    const registry = new SignalRegistry();
    assert.notOk(registry.has("/name"), "false before creation");
    registry.getOrCreate("/name", "Alice");
    assert.ok(registry.has("/name"), "true after creation");
    registry.destroy();
  });

  QUnit.test("set updates existing signal value", (assert) => {
    const registry = new SignalRegistry();
    registry.getOrCreate("/name", "Alice");
    registry.set("/name", "Bob");
    const signal = registry.get("/name") as Signal.State<unknown>;
    assert.strictEqual(signal.get(), "Bob", "value updated to Bob");
    registry.destroy();
  });

  QUnit.test("set is a no-op for unknown path", (assert) => {
    const registry = new SignalRegistry();
    registry.set("/unknown", "value");
    assert.strictEqual(registry.get("/unknown"), undefined, "no signal created");
    registry.destroy();
  });

  QUnit.test("invalidateChildren re-evaluates all child path signals", (assert) => {
    const registry = new SignalRegistry();
    registry.getOrCreate("/customer/name", "Alice");
    registry.getOrCreate("/customer/age", 28);
    registry.getOrCreate("/orders", []);

    registry.invalidateChildren("/customer", (path: string) => {
      if (path === "/customer/name") return "Bob";
      if (path === "/customer/age") return 30;
      return undefined;
    });

    const nameSignal = registry.get("/customer/name") as Signal.State<unknown>;
    const ageSignal = registry.get("/customer/age") as Signal.State<unknown>;
    const ordersSignal = registry.get("/orders") as Signal.State<unknown>;

    assert.strictEqual(nameSignal.get(), "Bob", "child name updated");
    assert.strictEqual(ageSignal.get(), 30, "child age updated");
    assert.deepEqual(ordersSignal.get(), [], "orders untouched");
    registry.destroy();
  });

  QUnit.test("invalidateAll re-evaluates every signal", (assert) => {
    const registry = new SignalRegistry();
    registry.getOrCreate("/a", 1);
    registry.getOrCreate("/b", 2);

    registry.invalidateAll((path: string) => {
      if (path === "/a") return 10;
      if (path === "/b") return 20;
      return undefined;
    });

    assert.strictEqual((registry.get("/a") as Signal.State<unknown>).get(), 10, "a updated");
    assert.strictEqual((registry.get("/b") as Signal.State<unknown>).get(), 20, "b updated");
    registry.destroy();
  });

  QUnit.test("addComputed creates a computed signal", (assert) => {
    const registry = new SignalRegistry();
    registry.getOrCreate("/firstName", "Alice");
    registry.getOrCreate("/lastName", "Smith");

    const computed = registry.addComputed(
      "/fullName",
      ["/firstName", "/lastName"],
      (first, last) => {
        return `${first} ${last}`;
      },
    );

    assert.strictEqual(computed.get(), "Alice Smith", "computed value is correct");
    assert.ok(registry.isComputed("/fullName"), "path is marked as computed");
    registry.destroy();
  });

  QUnit.test("addComputed on raw data path throws", (assert) => {
    const registry = new SignalRegistry();
    registry.getOrCreate("/name", "Alice");

    assert.throws(
      () => registry.addComputed("/name", [], () => "x"),
      TypeError,
      "throws TypeError when path has raw data",
    );
    registry.destroy();
  });

  QUnit.test("addComputed on existing computed replaces it", (assert) => {
    const registry = new SignalRegistry();
    registry.getOrCreate("/a", 1);

    registry.addComputed("/sum", ["/a"], (a) => (a as number) + 10);
    assert.strictEqual(
      (registry.get("/sum") as Signal.Computed<unknown>).get(),
      11,
      "first computed",
    );

    registry.addComputed("/sum", ["/a"], (a) => (a as number) + 20);
    assert.strictEqual(
      (registry.get("/sum") as Signal.Computed<unknown>).get(),
      21,
      "replaced computed",
    );
    registry.destroy();
  });

  QUnit.test("removeComputed removes a computed signal", (assert) => {
    const registry = new SignalRegistry();
    registry.getOrCreate("/a", 1);
    registry.addComputed("/sum", ["/a"], (a) => (a as number) + 10);

    registry.removeComputed("/sum");
    assert.notOk(registry.has("/sum"), "computed removed");
    assert.notOk(registry.isComputed("/sum"), "no longer computed");
    registry.destroy();
  });

  QUnit.test("destroy clears all signals", (assert) => {
    const registry = new SignalRegistry();
    registry.getOrCreate("/a", 1);
    registry.getOrCreate("/b", 2);

    registry.destroy();
    assert.notOk(registry.has("/a"), "a removed");
    assert.notOk(registry.has("/b"), "b removed");
  });
});
