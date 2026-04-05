import SignalModel from "ui5/model/signal/SignalModel";

QUnit.module("SignalPropertyBinding", () => {
  QUnit.test("binding reads initial value from model", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    assert.strictEqual(binding.getValue(), "Alice", "initial value is Alice");
    model.destroy();
  });

  QUnit.test("binding receives push notification on setProperty", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");

    binding.attachChange(() => {
      assert.strictEqual(binding.getValue(), "Bob", "value updated to Bob");
      model.destroy();
      done();
    });

    model.setProperty("/name", "Bob");
  });

  QUnit.test("binding does not fire when value is unchanged", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    let changeCount = 0;

    binding.attachChange(() => {
      changeCount++;
    });

    model.setProperty("/name", "Alice");

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "no change event fired");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("two-way binding: setValue updates model", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");

    binding.setValue("Bob");
    assert.strictEqual(model.getProperty("/name"), "Bob", "model updated via binding");
    model.destroy();
  });

  QUnit.test("multiple bindings to same path both fire", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding1 = model.bindProperty("/name");
    const binding2 = model.bindProperty("/name");
    let count = 0;

    binding1.attachChange(() => count++);
    binding2.attachChange(() => count++);

    model.setProperty("/name", "Bob");

    setTimeout(() => {
      assert.strictEqual(count, 2, "both bindings notified");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("binding to unrelated path does not fire", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice", age: 28 });
    const ageBinding = model.bindProperty("/age");
    let ageChangeCount = 0;

    ageBinding.attachChange(() => ageChangeCount++);

    model.setProperty("/name", "Bob");

    setTimeout(() => {
      assert.strictEqual(ageChangeCount, 0, "age binding not notified");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("suspended binding does not fire", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.suspend();

    model.setProperty("/name", "Bob");

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "no event while suspended");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("resume fires change for pending update", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.suspend();
    model.setProperty("/name", "Bob");

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "no change while suspended");
      binding.resume();
      setTimeout(() => {
        assert.ok(changeCount > 0, "change fired on resume");
        assert.strictEqual(binding.getValue(), "Bob", "value is current after resume");
        model.destroy();
        done();
      }, 50);
    }, 50);
  });

  QUnit.test("rapid-fire setProperty calls are batched into single change event", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ count: 0 });
    const binding = model.bindProperty("/count");
    let changeCount = 0;

    binding.attachChange(() => {
      changeCount++;
    });

    model.setProperty("/count", 1);
    model.setProperty("/count", 2);
    model.setProperty("/count", 3);

    setTimeout(() => {
      assert.strictEqual(changeCount, 1, "only one change event despite 3 setProperty calls");
      assert.strictEqual(binding.getValue(), 3, "final value is 3");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("setContext resubscribes to new signal path", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [{ name: "Alice" }, { name: "Bob" }],
    });
    const listBinding = model.bindList("/items");
    const contexts = listBinding.getContexts(0, 10);

    const binding = model.bindProperty("name", contexts[0]);
    assert.strictEqual(binding.getValue(), "Alice", "initial value from first context");

    binding.setContext(contexts[1]);

    let changeCount = 0;
    binding.attachChange(() => {
      changeCount++;
    });

    // Change to old path should NOT fire (binding now watches /items/1/name)
    model.setProperty("/items/0/name", "Carol");

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "old path change does not fire");

      // Change to new path should fire
      model.setProperty("/items/1/name", "Dave");

      setTimeout(() => {
        assert.strictEqual(changeCount, 1, "new path change fires");
        assert.strictEqual(binding.getValue(), "Dave", "value from new context path");
        model.destroy();
        done();
      }, 50);
    }, 50);
  });

  QUnit.test(
    "FlushQueue skips bindings destroyed mid-flush (no spurious checkUpdate)",
    (assert) => {
      const done = assert.async();
      const model = new SignalModel({ name: "Alice" });
      const binding1 = model.bindProperty("/name");
      const binding2 = model.bindProperty("/name");
      let checkUpdateCalledAfterDestroy = false;

      // binding1's change handler fires during FlushQueue processing.
      // It destroys binding2, then monkey-patches checkUpdate to detect
      // whether FlushQueue still calls it on the destroyed binding.
      binding1.attachChange(() => {
        binding2.destroy();
        (binding2 as unknown as Record<string, unknown>).checkUpdate = () => {
          checkUpdateCalledAfterDestroy = true;
        };
      });

      model.setProperty("/name", "Bob");

      setTimeout(() => {
        assert.strictEqual(
          checkUpdateCalledAfterDestroy,
          false,
          "checkUpdate was not called on binding destroyed mid-flush",
        );
        model.destroy();
        done();
      }, 50);
    },
  );

  QUnit.test("FlushQueue continues working after mid-flush destroy", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ a: 1, b: 2 });
    const bindingA = model.bindProperty("/a");
    const bindingB = model.bindProperty("/b");
    let bChangeCount = 0;

    // Destroy bindingA during its own flush -- bindingB should still work afterward
    bindingA.attachChange(() => {
      bindingA.destroy();
    });

    bindingB.attachChange(() => bChangeCount++);

    model.setProperty("/a", 10);
    model.setProperty("/b", 20);

    setTimeout(() => {
      assert.strictEqual(bChangeCount, 1, "surviving binding was notified");
      assert.strictEqual(bindingB.getValue(), 20, "surviving binding has correct value");

      // Verify FlushQueue is not stuck -- subsequent changes still work
      bChangeCount = 0;
      model.setProperty("/b", 30);

      setTimeout(() => {
        assert.strictEqual(bChangeCount, 1, "FlushQueue still works after mid-flush destroy");
        assert.strictEqual(bindingB.getValue(), 30, "subsequent value is correct");
        model.destroy();
        done();
      }, 50);
    }, 50);
  });

  QUnit.test("destroy cleans up watcher", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");

    binding.destroy();
    assert.strictEqual(
      (binding as unknown as { watcher: unknown }).watcher,
      null,
      "watcher is null after destroy",
    );
    model.destroy();
  });

  QUnit.test("initialize skips subscribe when binding is already subscribed", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");

    // After bindProperty, the binding is already subscribed (watcher exists).
    const watcherBefore = (binding as unknown as { watcher: unknown }).watcher;
    assert.ok(watcherBefore, "watcher exists after bindProperty");

    // Spy: count subscribe calls by wrapping the method
    let subscribeCount = 0;
    const origSubscribe = binding.subscribe.bind(binding);
    (binding as unknown as Record<string, unknown>).subscribe = () => {
      subscribeCount++;
      origSubscribe();
    };

    // Simulate what the UI5 framework does after bindProperty returns
    (binding as unknown as { initialize(): void }).initialize();

    assert.strictEqual(subscribeCount, 0, "initialize did not re-subscribe");
    assert.ok(
      (binding as unknown as { watcher: unknown }).watcher,
      "watcher still exists after initialize",
    );
    assert.strictEqual(binding.getValue(), "Alice", "value is correct after initialize");
    model.destroy();
  });

  QUnit.test("destroyed binding does not fire after setProperty", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.destroy();

    model.setProperty("/name", "Bob");

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "no change event after destroy");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("checkUpdate with bForceUpdate fires even when value unchanged", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    let changeCount = 0;

    binding.attachChange(() => changeCount++);

    // Value is still "Alice" -- normal checkUpdate would skip, but force should fire
    binding.checkUpdate(true);

    setTimeout(() => {
      assert.strictEqual(changeCount, 1, "change event fired despite same value");
      assert.strictEqual(binding.getValue(), "Alice", "value is still Alice");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("refresh triggers binding re-read via checkUpdate", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    let changeCount = 0;

    binding.attachChange(() => changeCount++);

    // Mutate data directly (bypassing setProperty -- simulates external data change)
    (model.getData() as Record<string, unknown>).name = "Bob";

    // refresh(true) calls checkUpdate(true), which re-reads from model
    binding.refresh(true);

    setTimeout(() => {
      assert.strictEqual(changeCount, 1, "change event fired after refresh");
      assert.strictEqual(binding.getValue(), "Bob", "binding picked up mutated data");
      model.destroy();
      done();
    }, 50);
  });

  // =========================================================================
  // setContext edge cases
  // =========================================================================

  QUnit.test("setContext from valid context to null unsubscribes", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [{ name: "Alice" }],
    });
    const listBinding = model.bindList("/items");
    const contexts = listBinding.getContexts(0, 10);

    const binding = model.bindProperty("name", contexts[0]);
    assert.strictEqual(binding.getValue(), "Alice", "initial value");

    // Remove context by setting to undefined
    binding.setContext(undefined);

    let changeCount = 0;
    binding.attachChange(() => changeCount++);

    model.setProperty("/items/0/name", "Bob");

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "no change after context removed");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("setContext with non-relative binding does not resubscribe", (assert) => {
    const model = new SignalModel({
      name: "Alice",
      items: [{ name: "Bob" }],
    });

    // Absolute path binding -- not relative
    const binding = model.bindProperty("/name");
    assert.strictEqual(binding.getValue(), "Alice", "absolute binding works");

    let subscribeCount = 0;
    const origSubscribe = binding.subscribe.bind(binding);
    (binding as unknown as Record<string, unknown>).subscribe = () => {
      subscribeCount++;
      origSubscribe();
    };

    // Setting context on absolute binding -- should not resubscribe
    // (isRelative() returns false, so checkUpdate runs but subscribe doesn't)
    const ctx = model.createBindingContext("/items/0");
    binding.setContext(ctx!);

    assert.strictEqual(subscribeCount, 0, "subscribe not called for absolute binding setContext");
    model.destroy();
  });

  // =========================================================================
  // Binding on path where data is later deleted
  // =========================================================================

  QUnit.test("binding handles parent path being deleted", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>({ customer: { name: "Alice" } });
    const binding = model.bindProperty("/customer/name");
    assert.strictEqual(binding.getValue(), "Alice", "initial value");

    let changed = false;
    binding.attachChange(() => {
      changed = true;
    });

    // Delete the parent by replacing with primitive
    model.setProperty("/customer", null);

    setTimeout(() => {
      assert.ok(changed, "binding fired when parent deleted");
      assert.strictEqual(binding.getValue(), null, "value is null after parent deleted");
      model.destroy();
      done();
    }, 50);
  });

  // =========================================================================
  // setData fires change on property bindings
  // =========================================================================

  QUnit.test("setData replace fires on all active property bindings", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ a: 1, b: 2 });
    const bindingA = model.bindProperty("/a");
    const bindingB = model.bindProperty("/b");
    let aChanged = false;
    let bChanged = false;

    bindingA.attachChange(() => {
      aChanged = true;
    });
    bindingB.attachChange(() => {
      bChanged = true;
    });

    model.setData({ a: 10, b: 20 });

    setTimeout(() => {
      assert.ok(aChanged, "binding /a fired on setData");
      assert.ok(bChanged, "binding /b fired on setData");
      assert.strictEqual(bindingA.getValue(), 10, "a = 10");
      assert.strictEqual(bindingB.getValue(), 20, "b = 20");
      model.destroy();
      done();
    }, 50);
  });
});
