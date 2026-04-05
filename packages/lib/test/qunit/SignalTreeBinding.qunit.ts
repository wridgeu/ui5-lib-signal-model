import SignalModel from "ui5/model/signal/SignalModel";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import Sorter from "sap/ui/model/Sorter";

QUnit.module("SignalTreeBinding", () => {
  QUnit.test("getRootContexts returns root-level nodes", (assert) => {
    const model = new SignalModel({
      tree: [
        { name: "Root 1", children: [{ name: "Child 1.1" }] },
        { name: "Root 2", children: [] },
      ],
    });
    const binding = model.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);
    const roots = binding.getRootContexts();

    assert.strictEqual(roots.length, 2, "2 root nodes");
    assert.strictEqual(model.getProperty("name", roots[0]), "Root 1", "first root");
    assert.strictEqual(model.getProperty("name", roots[1]), "Root 2", "second root");
    model.destroy();
  });

  QUnit.test("getNodeContexts returns child nodes", (assert) => {
    const model = new SignalModel({
      tree: [
        {
          name: "Parent",
          children: [{ name: "Child A" }, { name: "Child B" }, { name: "Child C" }],
        },
      ],
    });
    const binding = model.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);
    const roots = binding.getRootContexts();
    const children = binding.getNodeContexts(roots[0]);

    assert.strictEqual(children.length, 3, "3 children");
    assert.strictEqual(model.getProperty("name", children[0]), "Child A", "first child");
    assert.strictEqual(model.getProperty("name", children[2]), "Child C", "third child");
    model.destroy();
  });

  QUnit.test("hasChildren returns correct values", (assert) => {
    const model = new SignalModel({
      tree: [{ name: "Parent", children: [{ name: "Child" }] }, { name: "Leaf" }],
    });
    const binding = model.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);
    const roots = binding.getRootContexts();

    assert.ok(binding.hasChildren(roots[0]), "parent has children");
    assert.notOk(binding.hasChildren(roots[1]), "leaf has no children");
    model.destroy();
  });

  QUnit.test("deeply nested tree traversal", (assert) => {
    const model = new SignalModel({
      tree: [
        {
          name: "L1",
          children: [
            {
              name: "L2",
              children: [{ name: "L3", children: [] }],
            },
          ],
        },
      ],
    });
    const binding = model.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);
    const roots = binding.getRootContexts();
    const level2 = binding.getNodeContexts(roots[0]);
    const level3 = binding.getNodeContexts(level2[0]);

    assert.strictEqual(model.getProperty("name", level3[0]), "L3", "deep traversal works");
    model.destroy();
  });

  QUnit.test("tree binding fires change when data is modified", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      tree: [{ name: "Original" }],
    });
    const binding = model.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);
    binding.getRootContexts();

    binding.attachChange(() => {
      const roots = binding.getRootContexts();
      assert.strictEqual(roots.length, 2, "tree updated to 2 roots");
      model.destroy();
      done();
    });

    model.setProperty("/tree", [{ name: "Original" }, { name: "Added" }]);
  });

  QUnit.test("destroy cleans up watcher", (assert) => {
    const model = new SignalModel({
      tree: [{ name: "Root" }],
    });
    const binding = model.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);
    binding.getRootContexts();

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
      tree: [{ name: "Original" }],
    });
    const binding = model.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);
    binding.getRootContexts();
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.destroy();

    model.setProperty("/tree", [{ name: "Original" }, { name: "Added" }]);

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "no change event after destroy");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("tree binding with filter", (assert) => {
    const model = new SignalModel({
      tree: [
        { name: "Alice", active: true, children: [] },
        { name: "Bob", active: false, children: [] },
        { name: "Carol", active: true, children: [] },
      ],
    });
    const binding = model.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);

    binding.filter([new Filter("active", FilterOperator.EQ, true)]);
    const roots = binding.getRootContexts();

    assert.strictEqual(roots.length, 2, "filtered to 2 active nodes");
    assert.strictEqual(model.getProperty("name", roots[0]), "Alice", "first is Alice");
    assert.strictEqual(model.getProperty("name", roots[1]), "Carol", "second is Carol");
    model.destroy();
  });

  QUnit.test("tree binding with sort", (assert) => {
    const model = new SignalModel({
      tree: [
        { name: "Carol", children: [] },
        { name: "Alice", children: [] },
        { name: "Bob", children: [] },
      ],
    });
    const binding = model.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);

    binding.sort(new Sorter("name"));
    const roots = binding.getRootContexts();

    assert.strictEqual(model.getProperty("name", roots[0]), "Alice", "sorted first");
    assert.strictEqual(model.getProperty("name", roots[1]), "Bob", "sorted second");
    assert.strictEqual(model.getProperty("name", roots[2]), "Carol", "sorted third");
    model.destroy();
  });

  // =========================================================================
  // Tree bindings do NOT support suspend/resume (parity with JSONTreeBinding)
  // =========================================================================

  QUnit.test("suspend has no effect on tree binding (parity with JSONTreeBinding)", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      tree: [{ name: "Root" }],
    });
    const binding = model.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);
    binding.getRootContexts();
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.suspend();

    model.setProperty("/tree", [{ name: "Root" }, { name: "New" }]);

    setTimeout(() => {
      // Tree bindings ignore bSuspended -- change fires regardless, matching JSONTreeBinding
      assert.ok(
        changeCount > 0,
        "change fires even while 'suspended' -- tree bindings do not support suspend",
      );
      const roots = binding.getRootContexts();
      assert.strictEqual(roots.length, 2, "tree updated despite suspend");
      model.destroy();
      done();
    }, 50);
  });

  // =========================================================================
  // setContext on tree binding
  // =========================================================================

  QUnit.test("setContext resubscribes tree binding to new path", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      sections: {
        a: { tree: [{ name: "A-Root", children: [] }] },
        b: {
          tree: [
            { name: "B-Root", children: [] },
            { name: "B-Second", children: [] },
          ],
        },
      },
    });

    const ctxA = model.createBindingContext("/sections/a");
    const binding = model.bindTree("tree", ctxA!, [], { arrayNames: ["children"] }, []);
    let roots = binding.getRootContexts();
    assert.strictEqual(roots.length, 1, "section A has 1 root");

    let changeCount = 0;
    binding.attachChange(() => changeCount++);

    const ctxB = model.createBindingContext("/sections/b");
    binding.setContext(ctxB!);

    setTimeout(() => {
      assert.ok(changeCount > 0, "change fired after setContext");
      roots = binding.getRootContexts();
      assert.strictEqual(roots.length, 2, "section B has 2 roots");
      model.destroy();
      done();
    }, 50);
  });

  // =========================================================================
  // checkUpdate(bForceUpdate) on tree binding
  // =========================================================================

  QUnit.test("checkUpdate with bForceUpdate fires even when data unchanged", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      tree: [{ name: "Root" }],
    });
    const binding = model.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);
    binding.getRootContexts();
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.checkUpdate(true);

    setTimeout(() => {
      assert.strictEqual(changeCount, 1, "force checkUpdate fires on tree binding");
      model.destroy();
      done();
    }, 50);
  });

  // =========================================================================
  // setData notifies tree binding
  // =========================================================================

  QUnit.test("setData fires change on tree binding", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      tree: [{ name: "Root" }],
    });
    const binding = model.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);
    binding.getRootContexts();
    let changed = false;

    binding.attachChange(() => {
      changed = true;
    });

    model.setData({ tree: [{ name: "Root" }, { name: "New" }] });

    setTimeout(() => {
      assert.ok(changed, "tree binding notified by setData");
      const roots = binding.getRootContexts();
      assert.strictEqual(roots.length, 2, "tree updated to 2 roots");
      model.destroy();
      done();
    }, 50);
  });

  // =========================================================================
  // Filter re-application after setData
  // =========================================================================

  QUnit.test("setData replaces data and filter is re-applied automatically", (assert) => {
    const done = assert.async();
    const treeData = {
      org: [
        {
          name: "Alice",
          role: "CEO",
          children: [
            {
              name: "Bob",
              role: "CTO",
              children: [
                { name: "Carol", role: "Dev", children: [] },
                { name: "Dave", role: "Dev", children: [] },
              ],
            },
            { name: "Eve", role: "CFO", children: [] },
          ],
        },
      ],
    };

    const model = new SignalModel(treeData);
    const binding = model.bindTree("/org", undefined, [], { arrayNames: ["children"] }, []);

    // Tree filter is a recursive whitelist: matching nodes + all ancestors are kept.
    // getRootContexts returns root-level entries that have matching descendants.
    binding.filter([new Filter("name", FilterOperator.Contains, "Carol")]);
    let roots = binding.getRootContexts();
    assert.strictEqual(roots.length, 1, "filter keeps 1 root (ancestor of Carol)");
    assert.strictEqual(
      model.getProperty("name", roots[0]),
      "Alice",
      "root is Alice (Carol's ancestor)",
    );

    // Walk down: Alice -> Bob -> Carol (Dave is pruned by filter)
    let children = binding.getNodeContexts(roots[0]);
    assert.strictEqual(children.length, 1, "Alice has 1 filtered child (Bob, ancestor of Carol)");
    let leaves = binding.getNodeContexts(children[0]);
    assert.strictEqual(leaves.length, 1, "Bob has 1 filtered child (Carol)");
    assert.strictEqual(model.getProperty("name", leaves[0]), "Carol", "leaf is Carol");

    binding.attachChange(() => {
      // After setData, filter is re-applied on new data.
      // New tree: Frank -> Grace -> Carol (+ Heidi pruned by filter)
      roots = binding.getRootContexts();
      assert.strictEqual(roots.length, 1, "filter re-applied: 1 root in new data");
      assert.strictEqual(model.getProperty("name", roots[0]), "Frank", "new root is Frank");
      children = binding.getNodeContexts(roots[0]);
      assert.strictEqual(children.length, 1, "Frank has 1 filtered child (Grace)");
      leaves = binding.getNodeContexts(children[0]);
      assert.strictEqual(leaves.length, 1, "Grace has 1 filtered child (Carol)");
      assert.strictEqual(model.getProperty("name", leaves[0]), "Carol", "leaf is still Carol");
      model.destroy();
      done();
    });

    // Replace all data; the filter should be re-applied on the new data
    model.setData({
      org: [
        {
          name: "Frank",
          role: "CEO",
          children: [
            {
              name: "Grace",
              role: "CTO",
              children: [
                { name: "Carol", role: "Architect", children: [] },
                { name: "Heidi", role: "Dev", children: [] },
              ],
            },
          ],
        },
      ],
    });
  });

  // =========================================================================
  // checkUpdate edge cases
  // =========================================================================

  QUnit.test("checkUpdate without force does NOT fire when data unchanged", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      org: [
        {
          name: "Alice",
          role: "CEO",
          children: [
            {
              name: "Bob",
              role: "CTO",
              children: [
                { name: "Carol", role: "Dev", children: [] },
                { name: "Dave", role: "Dev", children: [] },
              ],
            },
            { name: "Eve", role: "CFO", children: [] },
          ],
        },
      ],
    });
    const binding = model.bindTree("/org", undefined, [], { arrayNames: ["children"] }, []);
    binding.getRootContexts();
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.checkUpdate();

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "checkUpdate() without force does not fire");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("checkUpdate(true) fires change even when data unchanged", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      org: [
        {
          name: "Alice",
          role: "CEO",
          children: [
            {
              name: "Bob",
              role: "CTO",
              children: [
                { name: "Carol", role: "Dev", children: [] },
                { name: "Dave", role: "Dev", children: [] },
              ],
            },
            { name: "Eve", role: "CFO", children: [] },
          ],
        },
      ],
    });
    const binding = model.bindTree("/org", undefined, [], { arrayNames: ["children"] }, []);
    binding.getRootContexts();
    let changeCount = 0;

    binding.attachChange(() => changeCount++);
    binding.checkUpdate(true);

    setTimeout(() => {
      assert.strictEqual(changeCount, 1, "checkUpdate(true) fires change on tree binding");
      model.destroy();
      done();
    }, 50);
  });
});
