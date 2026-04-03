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
});
