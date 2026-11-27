import JSONModel from "sap/ui/model/json/JSONModel";
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
        assert.strictEqual(changeCount, 1, "change fired on resume");
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
      let checkUpdateCalledAfterDestroy = 0;

      // binding1's change handler fires during FlushQueue processing.
      // It destroys binding2, then patches both update entry points to detect
      // whether FlushQueue still calls into the destroyed binding.
      binding1.attachChange(() => {
        binding2.destroy();
        const patched = binding2 as unknown as Record<string, unknown>;
        patched.checkUpdate = patched._checkUpdateFromSignal = () => {
          checkUpdateCalledAfterDestroy++;
        };
      });

      model.setProperty("/name", "Bob");

      setTimeout(() => {
        assert.strictEqual(
          checkUpdateCalledAfterDestroy,
          0,
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

  QUnit.test(
    "a write of the value a path already holds does not reach its binding",
    async (assert) => {
      const model = new SignalModel({ name: "Alice" });
      const binding = model.bindProperty("/name");
      binding.attachChange(() => {});
      binding.initialize();
      let updates = 0;
      const patched = binding as unknown as Record<string, () => void>;
      patched._checkUpdateFromSignal = patched.checkUpdate = () => updates++;

      model.setProperty("/name", "Alice");
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(updates, 0, "no update queued for an unchanged value");
      model.setProperty("/name", "Bob");
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(updates, 1, "one update for a changed value");
      model.destroy();
    },
  );

  QUnit.test("initialize skips subscribe when binding is already subscribed", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");

    // After bindProperty, the binding is already subscribed.
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

    let changed = 0;
    binding.attachChange(() => {
      changed++;
    });

    // Delete the parent by replacing with primitive
    model.setProperty("/customer", null);

    setTimeout(() => {
      assert.strictEqual(changed, 1, "binding fired when parent deleted");
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
    let aChanged = 0;
    let bChanged = 0;

    bindingA.attachChange(() => {
      aChanged++;
    });
    bindingB.attachChange(() => {
      bChanged++;
    });

    model.setData({ a: 10, b: 20 });

    setTimeout(() => {
      assert.strictEqual(aChanged, 1, "binding /a fired on setData");
      assert.strictEqual(bChanged, 1, "binding /b fired on setData");
      assert.strictEqual(bindingA.getValue(), 10, "a = 10");
      assert.strictEqual(bindingB.getValue(), 20, "b = 20");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("checkUpdate without force does not fire for an unchanged value", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    let changeCount = 0;
    binding.attachChange(() => changeCount++);

    binding.checkUpdate();
    assert.strictEqual(changeCount, 0, "no change event for an unchanged value");

    binding.checkUpdate(true);
    assert.strictEqual(changeCount, 1, "forced update fires");
    model.destroy();
  });

  QUnit.test("suspended binding ignores a non-forced checkUpdate", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const binding = model.bindProperty("/name");
    let changeCount = 0;
    binding.attachChange(() => changeCount++);

    binding.suspend();
    model.setProperty("/name", "Bob");
    binding.checkUpdate();
    assert.strictEqual(changeCount, 0, "no change event while suspended");
    assert.strictEqual(binding.getValue(), "Alice", "value not refreshed while suspended");

    binding.checkUpdate(true);
    assert.strictEqual(changeCount, 1, "forced update fires while suspended");
    assert.strictEqual(binding.getValue(), "Bob", "forced update refreshes the value");
    model.destroy();
  });

  QUnit.test("a write back in the task of a two-way write reaches the binding", async (assert) => {
    const run = async (Model: typeof JSONModel | typeof SignalModel): Promise<string> => {
      const model = new Model({ x: 1, form: { y: 1 } });
      const results: unknown[] = [];
      for (const [path, reset] of [
        ["/x", (): unknown => model.setProperty("/x", 1)],
        ["/form/y", (): unknown => model.setProperty("/form", { y: 1 })],
        ["/form/y", (): unknown => model.setData({ form: { y: 1 } }, true)],
      ] as const) {
        const binding = model.bindProperty(path);
        let fired = 0;
        binding.attachChange(() => fired++);
        binding.initialize();
        fired = 0;
        // What a control does with user input, and a handler that takes it back
        binding.setValue(2);
        reset();
        await new Promise((resolve) => setTimeout(resolve, 0));
        results.push(binding.getValue(), fired);
        binding.destroy();
      }
      model.destroy();
      return results.join();
    };
    assert.strictEqual(
      await run(SignalModel),
      "1,1,1,1,1,1",
      "the binding shows the model's value",
    );
    assert.strictEqual(await run(SignalModel), await run(JSONModel), "as JSONModel");
  });

  QUnit.test("a binding refreshed after a change to getData() tells the model", async (assert) => {
    const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
    const run = async (Model: typeof JSONModel | typeof SignalModel): Promise<string> => {
      const initial: Record<string, unknown> = { x: 1, rows: [{ n: 1 }], o: { a: 1 } };
      const model = new Model(initial);
      const binding = model.bindProperty("/x");
      const other = model.bindProperty("/x");
      const list = model.bindList("/rows");
      const cell = model.bindProperty("/rows/0/n");
      const object = model.bindProperty("/o");
      let objectEvents = 0;
      for (const each of [binding, other, list, cell, object]) {
        each.attachChange(() => {});
        each.initialize();
      }
      // After a merge the data holds no undefined
      model.setData({ y: 1 }, true);
      await tick();
      object.attachChange(() => objectEvents++);
      const data = model.getData() as Record<string, unknown> & { rows: { n: number }[] };
      data.x = 2;
      data.rows[0].n = 2;
      data.draft = undefined;
      binding.refresh();
      list.refresh();
      object.refresh();
      await tick();
      const shown: unknown[] = [binding.getValue(), other.getValue(), objectEvents];
      object.refresh(true);
      await tick();
      shown.push(objectEvents);
      // For the model these must be changes, although its last writes held 1 too
      model.setProperty("/x", 1);
      model.setProperty("/rows/0/n", 1);
      model.setData({ saved: true }, true);
      await tick();
      shown.push(binding.getValue(), other.getValue(), cell.getValue());
      shown.push("draft" in (model.getData() as object));
      model.destroy();
      return shown.join();
    };
    // Second value: another binding on the path follows at once, in JSONModel at the next write
    assert.strictEqual(await run(SignalModel), "2,2,0,1,1,1,1,false");
    assert.strictEqual(await run(JSONModel), "2,1,0,1,1,1,1,false");
  });

  QUnit.test("a state signal goes with its last binding", async (assert) => {
    const model = new SignalModel({ rows: Array.from({ length: 2000 }, (_, n) => ({ n })) });
    // oxlint-disable-next-line typescript/no-explicit-any -- private state of the registry
    const registry = (model as any).registry as {
      signals: Map<string, unknown>;
      descendants: Map<string, string[]>;
    };
    const kept = model.getSignal("/rows/0/n");
    model.createComputed("/sum", ["/rows/1/n"], (n) => n);
    // A table that is scrolled: the same bindings, on other rows each time
    const first = model.bindProperty("/rows/0/n");
    const second = model.bindProperty("/rows/0/n");
    model.bindProperty("/rows/1/n").destroy();
    // Dropped and created again before the index is swept
    model.bindProperty("/rows/3/n").destroy();
    const live = model.bindProperty("/rows/3/n");
    for (let row = 4; row < 2000; row++) {
      const binding = model.bindProperty(`/rows/${row}/n`);
      assert.strictEqual(binding.getValue(), row);
      binding.destroy();
    }
    first.destroy();
    assert.ok(registry.signals.has("/rows/0/n"), "not while another binding is on the path");
    second.destroy();
    model.setProperty("/rows/3", { n: 33 });
    assert.strictEqual(live.getValue(), 3, "not yet");
    await Promise.resolve();
    assert.strictEqual(live.getValue(), 33, "a write above a binding that was there all along");
    live.destroy();
    assert.deepEqual(
      [...registry.signals.keys()],
      ["/rows/0/n", "/rows/1/n"],
      "left: the signal handed out by getSignal and the dependency of a computed",
    );
    assert.ok((registry.descendants.get("/rows") ?? []).length < 200, "the path index is swept");
    model.setProperty("/rows/0/n", 5);
    assert.strictEqual(kept.get(), 5, "the signal handed out still follows the model");
    const again = model.bindProperty("/rows/7/n");
    model.setProperty("/rows/7", { n: 70 });
    await Promise.resolve();
    assert.strictEqual(again.getValue(), 70, "a binding on a path that had a signal before");
    model.destroy();
  });

  // From here on: one scenario per review finding, run in both models
  type AnyModel = typeof JSONModel | typeof SignalModel;
  type Data = Record<string, unknown>;
  const later = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const inBoth = async (
    assert: Assert,
    expected: string,
    run: (Model: AnyModel) => Promise<unknown[]>,
  ): Promise<void> => {
    assert.strictEqual((await run(SignalModel)).join(), expected);
    assert.strictEqual((await run(JSONModel)).join(), expected, "as JSONModel");
  };

  QUnit.test("refresh() of a binding fires one change event at most", async (assert) => {
    await inBoth(assert, "1,1,1,0", async (Model) => {
      const data: Data = { o: { a: 1 }, x: 1 };
      const model = new Model(data);
      const object = model.bindProperty("/o");
      const suspended = model.bindProperty("/x");
      const other = model.bindProperty("/x");
      for (const each of [object, suspended, other]) each.initialize();
      let events = 0;
      let otherEvents = 0;
      object.attachChange(() => events++);
      suspended.attachChange(() => {});
      other.attachChange(() => otherEvents++);
      data.o = { a: 2 };
      object.refresh();
      await later();
      const shown = [events];
      // Another object with the same content is no change
      data.o = { a: 2 };
      object.refresh();
      await later();
      shown.push(events);
      // A suspended binding does nothing, also not for the other bindings on its path
      data.x = 2;
      suspended.suspend();
      suspended.refresh();
      await later();
      shown.push(other.getValue(), otherEvents);
      model.destroy();
      return shown;
    });
  });

  QUnit.test(
    "a list keyed by its row objects sees a merge made while suspended",
    async (assert) => {
      await inBoth(assert, "0,1", async (Model) => {
        const data: Data = { rows: [{ n: 1 }, { n: 2 }] };
        const model = new Model(data);
        const list = model.bindList("/rows");
        (
          list as unknown as { enableExtendedChangeDetection(detect: boolean, key: string): void }
        ).enableExtendedChangeDetection(false, "");
        list.initialize();
        list.getContexts(0, 10);
        let events = 0;
        list.attachChange(() => events++);
        list.suspend();
        model.setData({ rows: [{ n: 9 }] }, true);
        await later();
        const shown = [events];
        list.resume();
        await later();
        shown.push(events);
        model.destroy();
        return shown;
      });
    },
  );

  QUnit.test(
    "an asynchronous write of the old value after setValue reaches the binding",
    async (assert) => {
      await inBoth(assert, "1,1,1", async (Model) => {
        const data: Data = { x: 1 };
        const model = new Model(data);
        const binding = model.bindProperty("/x");
        binding.initialize();
        let events = 0;
        binding.attachChange(() => events++);
        binding.setValue(2);
        model.setProperty("/x", 1, undefined, true);
        await later(20);
        const shown = [binding.getValue(), model.getProperty("/x"), events];
        model.destroy();
        return shown;
      });
    },
  );

  QUnit.test(
    "a propertyChange handler that writes an object to the path: one event",
    async (assert) => {
      await inBoth(assert, '1,1,{"a":3}', async (Model) => {
        const data: Data = { o: { a: 1 } };
        const model = new Model(data);
        const binding = model.bindProperty("/o");
        const other = model.bindProperty("/o");
        binding.initialize();
        other.initialize();
        let events = 0;
        let otherEvents = 0;
        binding.attachChange(() => events++);
        other.attachChange(() => otherEvents++);
        model.attachEventOnce("propertyChange", () => model.setProperty("/o", { a: 3 }));
        binding.setValue({ a: 2 });
        await later();
        const shown = [events, otherEvents, JSON.stringify(binding.getValue())];
        model.destroy();
        return shown;
      });
    },
  );

  QUnit.test("observe: an object added by a merge is observed", async (assert) => {
    await inBoth(assert, "2", async (Model) => {
      const data: Data = { o: {} };
      let model: JSONModel | SignalModel;
      if (Model === SignalModel) {
        model = new SignalModel(data, { observe: true });
        (model as SignalModel).mergeProperty("/o", { child: { v: 1 } });
      } else {
        model = new JSONModel(data, true);
        model.setData({ o: { child: { v: 1 } } }, true);
      }
      const binding = model.bindProperty("/o/child/v");
      binding.initialize();
      binding.attachChange(() => {});
      (model.getData() as { o: { child: { v: number } } }).o.child.v = 2;
      await later();
      const shown = [binding.getValue()];
      model.destroy();
      return shown;
    });
  });

  QUnit.test(
    "a merged length of a root array reaches the bindings of its elements",
    async (assert) => {
      await inBoth(assert, "undefined,1,[1]", async (Model) => {
        const model = new Model([1, 2, 3] as unknown as Data);
        const element = model.bindProperty("/2");
        const length = model.bindProperty("/length");
        for (const each of [element, length]) {
          each.initialize();
          each.attachChange(() => {});
        }
        model.setData({ length: 1 }, true);
        await later();
        const shown = [
          String(element.getValue()),
          length.getValue(),
          JSON.stringify(model.getData()),
        ];
        model.destroy();
        return shown;
      });
    },
  );

  QUnit.test("no change event after destroy()", async (assert) => {
    await inBoth(assert, "0", async (Model) => {
      const data: Data = { x: 1, rows: [1] };
      const model = new Model(data);
      const binding = model.bindProperty("/x");
      const list = model.bindList("/rows");
      binding.initialize();
      list.initialize();
      let destroyed = false;
      let after = 0;
      binding.attachChange(() => destroyed && after++);
      list.attachChange(() => destroyed && after++);
      model.setProperty("/x", 2);
      model.setProperty("/rows", [1, 2]);
      model.destroy();
      destroyed = true;
      await later();
      return [after];
    });
  });

  QUnit.test("initialize() of a suspended binding fires no change event", async (assert) => {
    await inBoth(assert, "0,0,0", async (Model) => {
      const data: Data = { x: 1, rows: [1], tree: { nodes: [{}] } };
      const model = new Model(data);
      const shown: number[] = [];
      for (const binding of [
        model.bindProperty("/x"),
        model.bindList("/rows"),
        model.bindTree("/tree", undefined, [], { arrayNames: ["nodes"] }),
      ]) {
        let events = 0;
        binding.attachChange(() => events++);
        binding.suspend();
        binding.initialize();
        await later();
        shown.push(events);
      }
      model.destroy();
      return shown;
    });
  });

  QUnit.test(
    "bindings show what the data holds after a write, not what was written",
    async (assert) => {
      await inBoth(assert, "44,44,ABC", async (Model) => {
        const data: Data = {
          bytes: new Uint8Array(2),
          o: {
            get name(): string {
              return (this as unknown as { stored: string }).stored;
            },
            set name(value: string) {
              (this as unknown as { stored: string }).stored = value.toUpperCase();
            },
          },
        };
        const model = new Model(data);
        const bindings = ["/bytes/0", "/bytes/0", "/o/name"].map((path) => {
          const binding = model.bindProperty(path);
          binding.initialize();
          binding.attachChange(() => {});
          return binding;
        });
        model.setProperty("/bytes/0", 300);
        model.setProperty("/o/name", "abc");
        await later();
        const shown = bindings.map((binding) => binding.getValue());
        model.destroy();
        return shown;
      });
    },
  );
});
