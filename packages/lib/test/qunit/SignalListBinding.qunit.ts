import SignalModel from "ui5/model/signal/SignalModel";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import Sorter from "sap/ui/model/Sorter";

QUnit.module("SignalListBinding", () => {
  QUnit.test("binding returns contexts for array data", (assert) => {
    const model = new SignalModel({
      items: [{ name: "A" }, { name: "B" }, { name: "C" }],
    });
    const binding = model.bindList("/items");

    const contexts = binding.getContexts(0, 10);
    assert.strictEqual(contexts.length, 3, "3 contexts returned");
    assert.strictEqual(model.getProperty("name", contexts[0]), "A", "first item is A");
    assert.strictEqual(model.getProperty("name", contexts[2]), "C", "third item is C");

    model.destroy();
  });

  QUnit.test("getLength returns correct count", (assert) => {
    const model = new SignalModel({
      items: [{ name: "A" }, { name: "B" }],
    });
    const binding = model.bindList("/items");

    binding.getContexts(0, 10);
    assert.strictEqual(binding.getLength(), 2, "length is 2");

    model.destroy();
  });

  QUnit.test("binding fires change when list is modified", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [{ name: "A" }],
    });
    const binding = model.bindList("/items");
    binding.getContexts(0, 10);

    binding.attachChange(() => {
      const contexts = binding.getContexts(0, 10);
      assert.strictEqual(contexts.length, 2, "list updated to 2 items");
      model.destroy();
      done();
    });

    model.setProperty("/items", [{ name: "A" }, { name: "B" }]);
  });

  QUnit.test("filter narrows the results", (assert) => {
    const model = new SignalModel({
      items: [
        { name: "Alice", active: true },
        { name: "Bob", active: false },
        { name: "Carol", active: true },
      ],
    });
    const binding = model.bindList("/items");
    binding.getContexts(0, 10);

    binding.filter([new Filter("active", FilterOperator.EQ, true)]);
    const contexts = binding.getContexts(0, 10);

    assert.strictEqual(contexts.length, 2, "filtered to 2 active items");
    assert.strictEqual(model.getProperty("name", contexts[0]), "Alice", "first is Alice");
    assert.strictEqual(model.getProperty("name", contexts[1]), "Carol", "second is Carol");

    model.destroy();
  });

  QUnit.test("sort reorders the results", (assert) => {
    const model = new SignalModel({
      items: [{ name: "Carol" }, { name: "Alice" }, { name: "Bob" }],
    });
    const binding = model.bindList("/items");
    binding.getContexts(0, 10);

    binding.sort(new Sorter("name"));
    const contexts = binding.getContexts(0, 10);

    assert.strictEqual(model.getProperty("name", contexts[0]), "Alice", "sorted first");
    assert.strictEqual(model.getProperty("name", contexts[1]), "Bob", "sorted second");
    assert.strictEqual(model.getProperty("name", contexts[2]), "Carol", "sorted third");

    model.destroy();
  });

  QUnit.test("destroy cleans up watcher", (assert) => {
    const model = new SignalModel({
      items: [{ name: "A" }],
    });
    const binding = model.bindList("/items");
    binding.getContexts(0, 10);

    binding.destroy();
    assert.strictEqual(
      (binding as unknown as { watcher: unknown }).watcher,
      null,
      "watcher is null after destroy",
    );
    model.destroy();
  });

  QUnit.test("destroyed binding does not fire after setProperty", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [{ name: "A" }],
    });
    const binding = model.bindList("/items");
    binding.getContexts(0, 10);
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.destroy();

    model.setProperty("/items", [{ name: "A" }, { name: "B" }]);

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "no change event after destroy");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("binding to unrelated path does not fire", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [{ name: "A" }],
      other: "value",
    });
    const binding = model.bindList("/items");
    binding.getContexts(0, 10);
    let changed = false;

    binding.attachChange(() => {
      changed = true;
    });
    model.setProperty("/other", "newValue");

    setTimeout(() => {
      assert.notOk(changed, "list binding not notified for unrelated change");
      model.destroy();
      done();
    }, 50);
  });

  // =========================================================================
  // Suspended list binding
  // =========================================================================

  QUnit.test("suspended list binding does not fire", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [{ name: "A" }],
    });
    const binding = model.bindList("/items");
    binding.getContexts(0, 10);
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.suspend();

    model.setProperty("/items", [{ name: "A" }, { name: "B" }]);

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "no event while suspended");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("resume fires pending update for list binding", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [{ name: "A" }],
    });
    const binding = model.bindList("/items");
    binding.getContexts(0, 10);
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.suspend();

    model.setProperty("/items", [{ name: "A" }, { name: "B" }]);

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "no change while suspended");
      binding.resume();
      setTimeout(() => {
        assert.ok(changeCount > 0, "change fired on resume");
        const contexts = binding.getContexts(0, 10);
        assert.strictEqual(contexts.length, 2, "list has 2 items after resume");
        model.destroy();
        done();
      }, 50);
    }, 50);
  });

  // =========================================================================
  // setContext on list binding
  // =========================================================================

  QUnit.test("setContext resubscribes list binding to new path", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      departments: [
        { employees: [{ name: "Alice" }] },
        { employees: [{ name: "Bob" }, { name: "Carol" }] },
      ],
    });

    const ctx0 = model.createBindingContext("/departments/0");
    const binding = model.bindList("employees", ctx0!);
    let contexts = binding.getContexts(0, 10);
    assert.strictEqual(contexts.length, 1, "dept 0 has 1 employee");

    let changeCount = 0;
    binding.attachChange(() => changeCount++);

    const ctx1 = model.createBindingContext("/departments/1");
    binding.setContext(ctx1!);

    setTimeout(() => {
      assert.ok(changeCount > 0, "change fired after setContext");
      contexts = binding.getContexts(0, 10);
      assert.strictEqual(contexts.length, 2, "dept 1 has 2 employees");
      model.destroy();
      done();
    }, 50);
  });

  // =========================================================================
  // checkUpdate(bForceUpdate) on list binding
  // =========================================================================

  QUnit.test("checkUpdate with bForceUpdate fires even when data unchanged", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [{ name: "A" }],
    });
    const binding = model.bindList("/items");
    binding.getContexts(0, 10);
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.checkUpdate(true);

    setTimeout(() => {
      assert.strictEqual(changeCount, 1, "force checkUpdate fires on list binding");
      model.destroy();
      done();
    }, 50);
  });

  // =========================================================================
  // List binding on object (non-array) data
  // =========================================================================

  QUnit.test("list binding on object enumerates keys (parity)", (assert) => {
    const model = new SignalModel({
      lookup: { a: { label: "Alpha" }, b: { label: "Beta" } },
    });
    const binding = model.bindList("/lookup");
    const contexts = binding.getContexts(0, 10);

    assert.strictEqual(contexts.length, 2, "2 entries from object");
    assert.strictEqual(contexts[0].getPath(), "/lookup/a", "first key path");
    assert.strictEqual(contexts[1].getPath(), "/lookup/b", "second key path");
    assert.strictEqual(model.getProperty("label", contexts[0]), "Alpha", "first value");
    assert.strictEqual(model.getProperty("label", contexts[1]), "Beta", "second value");
    model.destroy();
  });

  // =========================================================================
  // setData notifies list binding
  // =========================================================================

  QUnit.test("setData fires change on list binding", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [{ name: "A" }],
    });
    const binding = model.bindList("/items");
    binding.getContexts(0, 10);
    let changed = false;

    binding.attachChange(() => {
      changed = true;
    });

    model.setData({ items: [{ name: "A" }, { name: "B" }, { name: "C" }] });

    setTimeout(() => {
      assert.ok(changed, "list binding notified by setData");
      const contexts = binding.getContexts(0, 10);
      assert.strictEqual(contexts.length, 3, "list updated to 3 items");
      model.destroy();
      done();
    }, 50);
  });

  // =========================================================================
  // List binding on path that becomes null/undefined
  // =========================================================================

  QUnit.test("list binding handles data becoming null", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>({
      items: [{ name: "A" }],
    });
    const binding = model.bindList("/items");
    binding.getContexts(0, 10);
    assert.strictEqual(binding.getLength(), 1, "initially 1 item");

    binding.attachChange(() => {
      const contexts = binding.getContexts(0, 10);
      assert.strictEqual(contexts.length, 0, "no contexts when data is null");
      assert.strictEqual(binding.getLength(), 0, "length is 0");
      model.destroy();
      done();
    });

    model.setProperty("/items", null);
  });
});
