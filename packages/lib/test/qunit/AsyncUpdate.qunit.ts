import SignalModel from "ui5/model/signal/SignalModel";

/**
 * Tests for setProperty with bAsyncUpdate=true.
 * Verifies deferred signal notification via _scheduleBulkSync.
 */
QUnit.module("AsyncUpdate (bAsyncUpdate)", () => {
  QUnit.test("bAsyncUpdate defers signal notification to setTimeout", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    let changeCount = 0;

    binding.attachChange(() => changeCount++);

    model.setProperty("/name", "Bob", undefined, true);

    // Data is written immediately
    assert.strictEqual(model.getProperty("/name"), "Bob", "data written immediately");

    // But signal not yet fired (setTimeout hasn't run)
    assert.strictEqual(changeCount, 0, "no change event yet (deferred)");

    setTimeout(() => {
      assert.strictEqual(changeCount, 1, "change event fired after setTimeout");
      assert.strictEqual(binding.getValue(), "Bob", "binding has correct value");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("multiple bAsyncUpdate calls batch into single sync", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ a: 1, b: 2, c: 3 });
    const bindingA = model.bindProperty("/a");
    const bindingB = model.bindProperty("/b");
    const bindingC = model.bindProperty("/c");
    let aCount = 0;
    let bCount = 0;
    let cCount = 0;

    bindingA.attachChange(() => aCount++);
    bindingB.attachChange(() => bCount++);
    bindingC.attachChange(() => cCount++);

    // All three use async update — should batch
    model.setProperty("/a", 10, undefined, true);
    model.setProperty("/b", 20, undefined, true);
    model.setProperty("/c", 30, undefined, true);

    assert.strictEqual(aCount + bCount + cCount, 0, "no events yet");

    setTimeout(() => {
      assert.strictEqual(aCount, 1, "a fired once");
      assert.strictEqual(bCount, 1, "b fired once");
      assert.strictEqual(cCount, 1, "c fired once");
      assert.strictEqual(bindingA.getValue(), 10, "a value correct");
      assert.strictEqual(bindingB.getValue(), 20, "b value correct");
      assert.strictEqual(bindingC.getValue(), 30, "c value correct");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("bAsyncUpdate followed by synchronous read returns new value", (assert) => {
    const model = new SignalModel({ count: 0 });

    model.setProperty("/count", 42, undefined, true);

    // Data is written immediately even though signal notification is deferred
    assert.strictEqual(
      model.getProperty("/count"),
      42,
      "getProperty returns new value immediately",
    );
    model.destroy();
  });

  QUnit.test("mixing sync and async setProperty", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ sync: "old", async: "old" });
    const syncBinding = model.bindProperty("/sync");
    const asyncBinding = model.bindProperty("/async");
    let syncCount = 0;
    let asyncCount = 0;

    syncBinding.attachChange(() => syncCount++);
    asyncBinding.attachChange(() => asyncCount++);

    // Sync setProperty fires signal immediately (via microtask)
    model.setProperty("/sync", "new");
    // Async setProperty defers to setTimeout
    model.setProperty("/async", "new", undefined, true);

    setTimeout(() => {
      assert.strictEqual(syncCount, 1, "sync binding fired");
      assert.strictEqual(asyncCount, 1, "async binding fired");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("bAsyncUpdate only schedules one bulk sync per batch", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ x: 0 });
    const binding = model.bindProperty("/x");
    let changeCount = 0;

    binding.attachChange(() => changeCount++);

    // Rapid async writes — only one setTimeout should be scheduled
    for (let i = 1; i <= 10; i++) {
      model.setProperty("/x", i, undefined, true);
    }

    assert.strictEqual(model.getProperty("/x"), 10, "last write wins immediately");

    setTimeout(() => {
      // One bulk sync → one signal invalidation → one checkUpdate
      assert.strictEqual(changeCount, 1, "binding fired exactly once for 10 rapid async writes");
      assert.strictEqual(binding.getValue(), 10, "binding has final value");
      model.destroy();
      done();
    }, 50);
  });
});
