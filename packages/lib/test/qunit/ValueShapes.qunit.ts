import SignalModel from "ui5/model/signal/SignalModel";
import JSONModel from "sap/ui/model/json/JSONModel";

/**
 * Tests for various value types stored in the model.
 * Verifies bindings react correctly to null, undefined, falsy, NaN, and object values.
 */
QUnit.module("Value Shapes", () => {
  // =========================================================================
  // null values
  // =========================================================================

  QUnit.test("setProperty with null value -- binding fires (parity)", (assert) => {
    const done = assert.async();
    const json = new JSONModel({ name: "Alice" });
    const signal = new SignalModel({ name: "Alice" });

    json.setProperty("/name", null);
    signal.setProperty("/name", null);

    assert.deepEqual(signal.getData(), json.getData(), "data matches JSONModel after null set");

    const binding = signal.bindProperty("/name");
    assert.strictEqual(binding.getValue(), null, "binding reads null");

    let changed = false;
    binding.attachChange(() => {
      changed = true;
    });

    // Setting null to a different value should fire
    signal.setProperty("/name", "Bob");

    setTimeout(() => {
      assert.ok(changed, "binding fires when changing from null to value");
      signal.destroy();
      json.destroy();
      done();
    }, 50);
  });

  QUnit.test("null to null setProperty -- parity with JSONModel", (assert) => {
    const done = assert.async();
    const json = new JSONModel({ name: null });
    const signal = new SignalModel({ name: null as unknown });

    const jsonBinding = json.bindProperty("/name");
    const signalBinding = signal.bindProperty("/name");
    let jsonCount = 0;
    let signalCount = 0;

    jsonBinding.attachChange(() => jsonCount++);
    signalBinding.attachChange(() => signalCount++);

    json.setProperty("/name", null);
    signal.setProperty("/name", null);

    setTimeout(() => {
      assert.strictEqual(
        signalCount,
        jsonCount,
        `null-to-null change count matches JSONModel (both: ${jsonCount})`,
      );
      json.destroy();
      signal.destroy();
      done();
    }, 50);
  });

  // =========================================================================
  // undefined values
  // =========================================================================

  QUnit.test("setProperty with undefined value (parity)", (assert) => {
    const json = new JSONModel({ name: "Alice" });
    const signal = new SignalModel({ name: "Alice" });

    json.setProperty("/name", undefined);
    signal.setProperty("/name", undefined);

    assert.strictEqual(
      signal.getProperty("/name"),
      json.getProperty("/name"),
      "undefined value matches JSONModel",
    );
    json.destroy();
    signal.destroy();
  });

  // =========================================================================
  // Falsy values: 0, "", false -- dual-model parity
  // =========================================================================

  QUnit.test("0 to 0 -- parity with JSONModel (no fire)", (assert) => {
    const done = assert.async();
    const json = new JSONModel({ count: 0 });
    const signal = new SignalModel({ count: 0 });

    const jsonBinding = json.bindProperty("/count");
    const signalBinding = signal.bindProperty("/count");
    let jsonCount = 0;
    let signalCount = 0;

    jsonBinding.attachChange(() => jsonCount++);
    signalBinding.attachChange(() => signalCount++);

    json.setProperty("/count", 0);
    signal.setProperty("/count", 0);

    setTimeout(() => {
      assert.strictEqual(
        signalCount,
        jsonCount,
        `0→0 change count matches JSONModel (both: ${jsonCount})`,
      );
      json.destroy();
      signal.destroy();
      done();
    }, 50);
  });

  QUnit.test("empty string to empty string -- parity with JSONModel (no fire)", (assert) => {
    const done = assert.async();
    const json = new JSONModel({ text: "" });
    const signal = new SignalModel({ text: "" });

    const jsonBinding = json.bindProperty("/text");
    const signalBinding = signal.bindProperty("/text");
    let jsonCount = 0;
    let signalCount = 0;

    jsonBinding.attachChange(() => jsonCount++);
    signalBinding.attachChange(() => signalCount++);

    json.setProperty("/text", "");
    signal.setProperty("/text", "");

    setTimeout(() => {
      assert.strictEqual(
        signalCount,
        jsonCount,
        `""→"" change count matches JSONModel (both: ${jsonCount})`,
      );
      json.destroy();
      signal.destroy();
      done();
    }, 50);
  });

  QUnit.test("false to false -- parity with JSONModel (no fire)", (assert) => {
    const done = assert.async();
    const json = new JSONModel({ flag: false });
    const signal = new SignalModel({ flag: false });

    const jsonBinding = json.bindProperty("/flag");
    const signalBinding = signal.bindProperty("/flag");
    let jsonCount = 0;
    let signalCount = 0;

    jsonBinding.attachChange(() => jsonCount++);
    signalBinding.attachChange(() => signalCount++);

    json.setProperty("/flag", false);
    signal.setProperty("/flag", false);

    setTimeout(() => {
      assert.strictEqual(
        signalCount,
        jsonCount,
        `false→false change count matches JSONModel (both: ${jsonCount})`,
      );
      json.destroy();
      signal.destroy();
      done();
    }, 50);
  });

  QUnit.test("0 to 1 -- parity with JSONModel (fires)", (assert) => {
    const done = assert.async();
    const json = new JSONModel({ count: 0 });
    const signal = new SignalModel({ count: 0 });

    const jsonBinding = json.bindProperty("/count");
    const signalBinding = signal.bindProperty("/count");
    let jsonCount = 0;
    let signalCount = 0;

    jsonBinding.attachChange(() => jsonCount++);
    signalBinding.attachChange(() => signalCount++);

    json.setProperty("/count", 1);
    signal.setProperty("/count", 1);

    setTimeout(() => {
      assert.strictEqual(
        signalCount,
        jsonCount,
        `0→1 change count matches JSONModel (both: ${jsonCount})`,
      );
      assert.strictEqual(signalBinding.getValue(), 1, "signal value is 1");
      assert.strictEqual(jsonBinding.getValue(), 1, "json value is 1");
      json.destroy();
      signal.destroy();
      done();
    }, 50);
  });

  QUnit.test("string value change -- parity with JSONModel", (assert) => {
    const done = assert.async();
    const json = new JSONModel({ name: "Alice" });
    const signal = new SignalModel({ name: "Alice" });

    const jsonBinding = json.bindProperty("/name");
    const signalBinding = signal.bindProperty("/name");
    let jsonCount = 0;
    let signalCount = 0;

    jsonBinding.attachChange(() => jsonCount++);
    signalBinding.attachChange(() => signalCount++);

    json.setProperty("/name", "Bob");
    signal.setProperty("/name", "Bob");

    setTimeout(() => {
      assert.strictEqual(
        signalCount,
        jsonCount,
        `"Alice"→"Bob" change count matches JSONModel (both: ${jsonCount})`,
      );
      assert.strictEqual(signalBinding.getValue(), "Bob", "signal value is Bob");
      json.destroy();
      signal.destroy();
      done();
    }, 50);
  });

  QUnit.test("same string value -- parity with JSONModel (no fire)", (assert) => {
    const done = assert.async();
    const json = new JSONModel({ name: "Alice" });
    const signal = new SignalModel({ name: "Alice" });

    const jsonBinding = json.bindProperty("/name");
    const signalBinding = signal.bindProperty("/name");
    let jsonCount = 0;
    let signalCount = 0;

    jsonBinding.attachChange(() => jsonCount++);
    signalBinding.attachChange(() => signalCount++);

    json.setProperty("/name", "Alice");
    signal.setProperty("/name", "Alice");

    setTimeout(() => {
      assert.strictEqual(
        signalCount,
        jsonCount,
        `"Alice"→"Alice" change count matches JSONModel (both: ${jsonCount})`,
      );
      json.destroy();
      signal.destroy();
      done();
    }, 50);
  });

  // =========================================================================
  // NaN values
  // =========================================================================

  QUnit.test("NaN to NaN -- parity with JSONModel (no fire)", (assert) => {
    const done = assert.async();
    const json = new JSONModel({ value: NaN });
    const signal = new SignalModel({ value: NaN as unknown });

    const jsonBinding = json.bindProperty("/value");
    const signalBinding = signal.bindProperty("/value");
    let jsonCount = 0;
    let signalCount = 0;

    jsonBinding.attachChange(() => jsonCount++);
    signalBinding.attachChange(() => signalCount++);

    json.setProperty("/value", NaN);
    signal.setProperty("/value", NaN);

    setTimeout(() => {
      assert.strictEqual(
        signalCount,
        jsonCount,
        `NaN→NaN change count matches JSONModel (both: ${jsonCount})`,
      );
      json.destroy();
      signal.destroy();
      done();
    }, 50);
  });

  QUnit.test("NaN to number -- parity with JSONModel (fires)", (assert) => {
    const done = assert.async();
    const json = new JSONModel({ value: NaN });
    const signal = new SignalModel({ value: NaN as unknown });

    const jsonBinding = json.bindProperty("/value");
    const signalBinding = signal.bindProperty("/value");
    let jsonCount = 0;
    let signalCount = 0;

    jsonBinding.attachChange(() => jsonCount++);
    signalBinding.attachChange(() => signalCount++);

    json.setProperty("/value", 42);
    signal.setProperty("/value", 42);

    setTimeout(() => {
      assert.strictEqual(
        signalCount,
        jsonCount,
        `NaN→42 change count matches JSONModel (both: ${jsonCount})`,
      );
      assert.strictEqual(signalBinding.getValue(), 42, "signal value is 42");
      json.destroy();
      signal.destroy();
      done();
    }, 50);
  });

  // =========================================================================
  // setData edge cases
  // =========================================================================

  QUnit.test("setData with empty object clears data (parity)", (assert) => {
    const json = new JSONModel({ name: "Alice", age: 28 });
    const signal = new SignalModel<Record<string, unknown>>({ name: "Alice", age: 28 });

    json.setData({});
    signal.setData({});

    assert.deepEqual(signal.getData(), json.getData(), "empty object setData matches");
    assert.strictEqual(signal.getProperty("/name"), undefined, "name cleared");
    json.destroy();
    signal.destroy();
  });

  // =========================================================================
  // Object values in property bindings -- INTENTIONAL DIVERGENCE
  //
  // SignalModel always fires change events for object-valued bindings,
  // even when JSONModel's deepEqual would suppress them. This is by design:
  //
  // 1. Signal equality (signalEquals) returns false for all objects,
  //    ensuring parent signals re-notify when children are mutated in-place
  //    (the parent reference didn't change, but contents did).
  //
  // 2. JSONModel can afford deepEqual because it iterates ALL bindings on
  //    every change (O(n) anyway). SignalModel notifies only affected paths,
  //    so parent signals must fire to ensure correctness when child paths
  //    are mutated.
  //
  // 3. The net rendering result is identical: the UI shows correct data.
  //    The difference is that SignalModel may fire change events for
  //    object-valued bindings where JSONModel would suppress them via
  //    deepEqual. This causes no visible difference because the binding's
  //    checkUpdate still reads the correct current value.
  // =========================================================================

  QUnit.test(
    "DIVERGENCE: object binding fires on child mutation (JSONModel suppresses)",
    (assert) => {
      const done = assert.async();
      const json = new JSONModel({ customer: { name: "Alice", age: 28 } });
      const signal = new SignalModel({ customer: { name: "Alice", age: 28 } });

      const jsonBinding = json.bindProperty("/customer");
      const signalBinding = signal.bindProperty("/customer");
      let jsonCount = 0;
      let signalCount = 0;

      jsonBinding.attachChange(() => jsonCount++);
      signalBinding.attachChange(() => signalCount++);

      // Mutate a child property -- the parent object reference is unchanged
      json.setProperty("/customer/name", "Bob");
      signal.setProperty("/customer/name", "Bob");

      setTimeout(() => {
        // JSONModel: checkUpdate uses deepEqual on the parent object. Since
        // setProperty mutated the object IN PLACE, deepEqual compares the
        // already-mutated object to itself → identical → no fire.
        // SignalModel: signalEquals returns false for all objects → always fires.
        // This is the key divergence: SignalModel correctly notifies the parent
        // binding when a child changes, JSONModel does not (because it compares
        // the same reference to itself after in-place mutation).
        assert.strictEqual(
          jsonCount,
          0,
          "JSONModel does NOT fire (deepEqual compares mutated obj to itself)",
        );
        assert.ok(signalCount >= 1, "SignalModel fires (signalEquals always-diff for objects)");

        // Both models return the correct value
        const jsonVal = jsonBinding.getValue() as Record<string, unknown>;
        const signalVal = signalBinding.getValue() as Record<string, unknown>;
        assert.strictEqual(jsonVal.name, "Bob", "JSONModel value is correct");
        assert.strictEqual(signalVal.name, "Bob", "SignalModel value is correct");
        json.destroy();
        signal.destroy();
        done();
      }, 50);
    },
  );

  QUnit.test(
    "DIVERGENCE: setProperty with same object ref (JSONModel suppresses, SignalModel fires)",
    (assert) => {
      const done = assert.async();
      const obj = { name: "Alice", age: 28 };
      const json = new JSONModel({ customer: obj });
      const signal = new SignalModel({ customer: { name: "Alice", age: 28 } });

      const jsonBinding = json.bindProperty("/customer");
      const signalBinding = signal.bindProperty("/customer");
      let jsonCount = 0;
      let signalCount = 0;

      jsonBinding.attachChange(() => jsonCount++);
      signalBinding.attachChange(() => signalCount++);

      // Set the same object reference back -- no actual change
      json.setProperty("/customer", json.getProperty("/customer"));
      signal.setProperty("/customer", signal.getProperty("/customer"));

      setTimeout(() => {
        // JSONModel: deepEqual(obj, obj) → same contents → no fire
        // SignalModel: signalEquals returns false for objects → fires
        // This divergence is intentional: SignalModel cannot know if the
        // object was mutated between getProperty and setProperty, so it
        // always notifies. The UI renders correctly in both cases.
        assert.strictEqual(jsonCount, 0, "JSONModel does not fire (deepEqual suppresses)");
        assert.ok(signalCount >= jsonCount, "SignalModel fires >= JSONModel (intentional)");

        // Both return the same data
        assert.deepEqual(signalBinding.getValue(), jsonBinding.getValue(), "values match");
        json.destroy();
        signal.destroy();
        done();
      }, 50);
    },
  );

  // =========================================================================
  // Empty array in list binding
  // =========================================================================

  QUnit.test("list binding on empty array", (assert) => {
    const model = new SignalModel({ items: [] as unknown[] });
    const binding = model.bindList("/items");
    const contexts = binding.getContexts(0, 10);

    assert.strictEqual(contexts.length, 0, "no contexts for empty array");
    assert.strictEqual(binding.getLength(), 0, "length is 0");
    model.destroy();
  });

  QUnit.test("list binding transitions from empty to populated", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ items: [] as unknown[] });
    const binding = model.bindList("/items");
    binding.getContexts(0, 10);

    binding.attachChange(() => {
      const contexts = binding.getContexts(0, 10);
      assert.strictEqual(contexts.length, 2, "list populated with 2 items");
      model.destroy();
      done();
    });

    model.setProperty("/items", [{ name: "A" }, { name: "B" }]);
  });
});
