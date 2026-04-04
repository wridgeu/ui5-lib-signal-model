import SignalModel from "ui5/model/signal/SignalModel";
import Text from "sap/m/Text";

QUnit.module("ComputedSignals", () => {
  QUnit.test("createComputed creates a derived value", (assert) => {
    const model = new SignalModel({ firstName: "Alice", lastName: "Smith" });
    model.createComputed("/fullName", ["/firstName", "/lastName"], (first, last) => {
      return `${first} ${last}`;
    });
    const binding = model.bindProperty("/fullName");
    assert.strictEqual(binding.getValue(), "Alice Smith", "computed value correct");
    model.destroy();
  });

  QUnit.test("computed updates when dependency changes", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ firstName: "Alice", lastName: "Smith" });
    model.createComputed("/fullName", ["/firstName", "/lastName"], (first, last) => {
      return `${first} ${last}`;
    });
    const binding = model.bindProperty("/fullName");
    binding.attachChange(() => {
      assert.strictEqual(binding.getValue(), "Bob Smith", "computed updated");
      model.destroy();
      done();
    });
    model.setProperty("/firstName", "Bob");
  });

  QUnit.test("setProperty on computed path returns false", (assert) => {
    const model = new SignalModel({ a: 1 });
    model.createComputed("/doubled", ["/a"], (a) => (a as number) * 2);
    const result = model.setProperty("/doubled", 99);
    assert.notOk(result, "returns false for write to computed");
    assert.strictEqual(model.getProperty("/doubled"), 2, "computed value unchanged");
    model.destroy();
  });

  QUnit.test("setProperty on computed sub-path returns false", (assert) => {
    const model = new SignalModel({
      items: [{ name: "Alice", age: 28 }],
    });
    model.createComputed("/first", ["/items"], (items) => (items as { name: string }[])[0]);

    const result = model.setProperty("/first/name", "Carol");
    assert.notOk(result, "returns false for write to computed sub-path");
    assert.strictEqual(model.getProperty("/items/0/name"), "Alice", "source data unchanged");
    model.destroy();
  });

  QUnit.test("mergeProperty on computed path returns false", (assert) => {
    const model = new SignalModel({
      items: [{ name: "Alice", age: 28 }],
    });
    model.createComputed("/first", ["/items"], (items) => (items as { name: string }[])[0]);

    const result = model.mergeProperty("/first", { name: "Carol" });
    assert.notOk(result, "returns false for merge to computed path");
    assert.strictEqual(model.getProperty("/items/0/name"), "Alice", "source data unchanged");
    model.destroy();
  });

  QUnit.test("mergeProperty on computed sub-path returns false", (assert) => {
    const model = new SignalModel({
      users: [{ name: "Alice", profile: { bio: "dev" } }],
    });
    model.createComputed("/first", ["/users"], (u) => (u as Record<string, unknown>[])[0]);

    const result = model.mergeProperty("/first/profile", { bio: "designer" });
    assert.notOk(result, "returns false for merge to computed sub-path");
    assert.strictEqual(model.getProperty("/users/0/profile/bio"), "dev", "source data unchanged");
    model.destroy();
  });

  QUnit.test("createComputed on raw data path throws", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    model.bindProperty("/name");
    assert.throws(
      () => model.createComputed("/name", [], () => "x"),
      TypeError,
      "throws when path has raw data",
    );
    model.destroy();
  });

  QUnit.test("createComputed on existing computed throws", (assert) => {
    const model = new SignalModel({ a: 5 });
    model.createComputed("/result", ["/a"], (a) => (a as number) + 10);
    assert.throws(
      () => model.createComputed("/result", ["/a"], (a) => (a as number) * 2),
      TypeError,
      "throws when computed already exists",
    );
    model.destroy();
  });

  QUnit.test("removeComputed then createComputed redefines the derivation", (assert) => {
    const model = new SignalModel({ a: 5 });
    model.createComputed("/result", ["/a"], (a) => (a as number) + 10);
    assert.strictEqual(model.bindProperty("/result").getValue(), 15, "first computed");

    model.removeComputed("/result");
    model.createComputed("/result", ["/a"], (a) => (a as number) * 2);
    assert.strictEqual(model.bindProperty("/result").getValue(), 10, "redefined computed");
    model.destroy();
  });

  QUnit.test("removeComputed removes the computed signal", (assert) => {
    const model = new SignalModel({ a: 1 });
    model.createComputed("/doubled", ["/a"], (a) => (a as number) * 2);
    model.removeComputed("/doubled");
    const binding = model.bindProperty("/doubled");
    assert.strictEqual(binding.getValue(), undefined, "computed removed, returns undefined");
    model.destroy();
  });

  QUnit.test("chained computed: computed depending on another computed", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ a: 5 });
    model.createComputed("/double", ["/a"], (a) => (a as number) * 2);
    model.createComputed("/quad", ["/double"], (d) => (d as number) * 2);

    const doubleBinding = model.bindProperty("/double");
    const quadBinding = model.bindProperty("/quad");
    assert.strictEqual(doubleBinding.getValue(), 10, "double = 5 * 2 = 10");
    assert.strictEqual(quadBinding.getValue(), 20, "quad = 10 * 2 = 20");

    quadBinding.attachChange(() => {
      assert.strictEqual(doubleBinding.getValue(), 14, "double updated to 7 * 2 = 14");
      assert.strictEqual(quadBinding.getValue(), 28, "quad updated to 14 * 2 = 28");
      model.destroy();
      done();
    });

    model.setProperty("/a", 7);
  });

  QUnit.test(
    "existing binding updates after removeComputed + createComputed (same deps)",
    (assert) => {
      const done = assert.async();
      const model = new SignalModel({ a: 5 });
      model.createComputed("/result", ["/a"], (a) => (a as number) + 10);

      // Simulate an XML view binding that was created before the redefine
      const binding = model.bindProperty("/result");
      assert.strictEqual(binding.getValue(), 15, "binding reads original computed");

      // Redefine: remove + recreate with same dependencies
      model.removeComputed("/result");
      model.createComputed("/result", ["/a"], (a) => (a as number) * 3);

      // Trigger a dependency change — binding should see the new formula
      binding.attachChange(() => {
        assert.strictEqual(binding.getValue(), 21, "binding sees new computed (7 * 3 = 21)");
        model.destroy();
        done();
      });

      model.setProperty("/a", 7);
    },
  );

  QUnit.test(
    "existing binding updates after removeComputed + createComputed (different deps)",
    (assert) => {
      const done = assert.async();
      const model = new SignalModel({ a: 5, b: 100 });
      model.createComputed("/result", ["/a"], (a) => (a as number) + 10);

      const binding = model.bindProperty("/result");
      assert.strictEqual(binding.getValue(), 15, "binding reads original computed");

      // Redefine with DIFFERENT dependencies — the real test.
      // Without re-subscribe, changing /b would never fire the old watcher.
      model.removeComputed("/result");
      model.createComputed("/result", ["/b"], (b) => (b as number) * 2);

      binding.attachChange(() => {
        assert.strictEqual(binding.getValue(), 400, "binding sees new computed (200 * 2 = 400)");
        model.destroy();
        done();
      });

      // Change the NEW dependency — binding must update
      model.setProperty("/b", 200);
    },
  );

  QUnit.test("computed with multiple dependencies", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ price: 100, tax: 0.2 });
    model.createComputed("/total", ["/price", "/tax"], (price, tax) => {
      return (price as number) * (1 + (tax as number));
    });
    const binding = model.bindProperty("/total");
    assert.strictEqual(binding.getValue(), 120, "initial total correct");
    binding.attachChange(() => {
      assert.strictEqual(binding.getValue(), 240, "total updated when price changes");
      model.destroy();
      done();
    });
    model.setProperty("/price", 200);
  });

  // =========================================================================
  // Computed signals with list binding
  // =========================================================================

  QUnit.test("bindList on computed path that returns an array", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [
        { name: "Alice", active: true },
        { name: "Bob", active: false },
        { name: "Carol", active: true },
      ],
    });

    model.createComputed("/activeItems", ["/items"], (items) => {
      return (items as { name: string; active: boolean }[]).filter((i) => i.active);
    });

    const binding = model.bindList("/activeItems");
    let contexts = binding.getContexts(0, 10);
    assert.strictEqual(contexts.length, 2, "computed list has 2 active items");

    binding.attachChange(() => {
      contexts = binding.getContexts(0, 10);
      assert.strictEqual(contexts.length, 3, "computed list updated to 3 active items");
      model.destroy();
      done();
    });

    // Make Bob active — the computed should re-evaluate
    model.setProperty("/items", [
      { name: "Alice", active: true },
      { name: "Bob", active: true },
      { name: "Carol", active: true },
    ]);
  });

  // =========================================================================
  // Computed signals with tree binding
  // =========================================================================

  QUnit.test("bindTree on computed path that returns tree data", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      rawNodes: [{ name: "Parent", children: [{ name: "Child A" }] }, { name: "Leaf" }],
    });

    model.createComputed("/tree", ["/rawNodes"], (nodes) => {
      return (nodes as { name: string }[]).map((n) =>
        Object.assign({}, n, {
          children: (n as Record<string, unknown>).children || [],
        }),
      );
    });

    const binding = model.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);
    let roots = binding.getRootContexts();
    assert.strictEqual(roots.length, 2, "computed tree has 2 root nodes");

    binding.attachChange(() => {
      roots = binding.getRootContexts();
      assert.strictEqual(roots.length, 3, "computed tree updated to 3 roots");
      model.destroy();
      done();
    });

    model.setProperty("/rawNodes", [
      { name: "Parent", children: [{ name: "Child A" }] },
      { name: "Leaf" },
      { name: "New Node" },
    ]);
  });

  // =========================================================================
  // Computed with zero dependencies
  // =========================================================================

  QUnit.test("computed with zero dependencies returns constant value", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ other: "data" });
    model.createComputed("/constant", [], () => 42);

    const binding = model.bindProperty("/constant");
    assert.strictEqual(binding.getValue(), 42, "constant computed returns 42");

    let changeCount = 0;
    binding.attachChange(() => changeCount++);

    // Changing unrelated data should not fire the constant computed
    model.setProperty("/other", "changed");

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "constant computed does not fire on unrelated change");
      assert.strictEqual(binding.getValue(), 42, "value still 42");
      model.destroy();
      done();
    }, 50);
  });

  // =========================================================================
  // getSignal for computed path
  // =========================================================================

  QUnit.test("getSignal returns computed signal and pre-evaluates it", (assert) => {
    const model = new SignalModel({ a: 5 });
    model.createComputed("/doubled", ["/a"], (a) => (a as number) * 2);

    const signal = model.getSignal("/doubled");
    assert.ok(signal, "computed signal returned");
    assert.strictEqual(signal.get(), 10, "computed signal pre-evaluated to 10");
    model.destroy();
  });

  // =========================================================================
  // getSignal for non-existent path
  // =========================================================================

  QUnit.test("getSignal for non-existent path creates state signal with undefined", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const signal = model.getSignal("/nonexistent");
    assert.ok(signal, "signal created on demand");
    assert.strictEqual(signal.get(), undefined, "initial value is undefined");
    model.destroy();
  });

  // =========================================================================
  // getSignal called multiple times returns same instance
  // =========================================================================

  QUnit.test("getSignal returns same instance for same path", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const signal1 = model.getSignal("/name");
    const signal2 = model.getSignal("/name");
    assert.strictEqual(signal1, signal2, "same signal instance returned");
    model.destroy();
  });

  // =========================================================================
  // Computed with dependency that doesn't exist in data
  // =========================================================================

  QUnit.test("computed with missing dependency returns undefined for that dep", (assert) => {
    const model = new SignalModel({});
    model.createComputed("/result", ["/missing"], (val) => (val === undefined ? "default" : val));

    const binding = model.bindProperty("/result");
    assert.strictEqual(
      binding.getValue(),
      "default",
      "missing dep yields undefined, fallback works",
    );
    model.destroy();
  });

  // =========================================================================
  // Computed sub-path traversal
  // =========================================================================

  QUnit.test("getProperty traverses into computed object value", (assert) => {
    const model = new SignalModel({
      items: [{ name: "Alice" }, { name: "Bob" }],
    });
    model.createComputed("/firstItem", ["/items"], (items) => {
      return (items as { name: string }[])[0];
    });

    assert.strictEqual(
      model.getProperty("/firstItem/name"),
      "Alice",
      "getProperty resolves sub-path through computed",
    );
    model.destroy();
  });

  QUnit.test("property binding to sub-path of computed object", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [{ name: "Alice" }, { name: "Bob" }],
    });
    model.createComputed("/firstItem", ["/items"], (items) => {
      return (items as { name: string }[])[0];
    });

    const binding = model.bindProperty("/firstItem/name");
    assert.strictEqual(binding.getValue(), "Alice", "binding reads computed sub-path");

    model.setProperty("/items", [{ name: "Carol" }, { name: "Dave" }]);

    setTimeout(() => {
      assert.strictEqual(binding.getValue(), "Carol", "binding updates when computed changes");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("list binding on computed array — relative getProperty", (assert) => {
    const model = new SignalModel({
      items: [
        { name: "Alice", active: true },
        { name: "Bob", active: false },
        { name: "Carol", active: true },
      ],
    });
    model.createComputed("/activeItems", ["/items"], (items) => {
      return (items as { name: string; active: boolean }[]).filter((i) => i.active);
    });

    const binding = model.bindList("/activeItems");
    const contexts = binding.getContexts(0, 10);
    assert.strictEqual(contexts.length, 2, "2 active items");
    assert.strictEqual(
      model.getProperty("name", contexts[0]),
      "Alice",
      "relative getProperty resolves through computed list",
    );
    assert.strictEqual(
      model.getProperty("name", contexts[1]),
      "Carol",
      "second context resolves correctly",
    );
    model.destroy();
  });

  QUnit.test("deeply nested sub-path of computed", (assert) => {
    const model = new SignalModel({ x: 1 });
    model.createComputed("/deep", ["/x"], () => ({
      level1: { level2: { value: 42 } },
    }));

    assert.strictEqual(
      model.getProperty("/deep/level1/level2/value"),
      42,
      "deep traversal into computed works",
    );
    model.destroy();
  });

  QUnit.test("computed shadows pre-existing data at same path", (assert) => {
    const model = new SignalModel({ c: { name: "from-data" } });
    model.createComputed("/c", [], () => ({ name: "from-computed" }));

    assert.strictEqual(
      model.getProperty("/c/name"),
      "from-computed",
      "computed value takes precedence over data",
    );
    assert.strictEqual(
      model.getProperty("/c"),
      model.getSignal("/c").get(),
      "getProperty returns computed value, not data",
    );
    model.destroy();
  });

  QUnit.test("computed returning null — sub-path returns null", (assert) => {
    const model = new SignalModel({ x: 1 });
    model.createComputed("/nullable", ["/x"], () => null);

    assert.strictEqual(
      model.getProperty("/nullable/anything"),
      null,
      "sub-path of null computed returns null",
    );
    model.destroy();
  });

  QUnit.test("computed returning primitive — sub-path returns undefined", (assert) => {
    const model = new SignalModel({ x: 1 });
    model.createComputed("/prim", ["/x"], (x) => (x as number) * 2);

    assert.strictEqual(
      model.getProperty("/prim/anything"),
      undefined,
      "sub-path of primitive computed returns undefined",
    );
    model.destroy();
  });

  QUnit.test("bindElement on computed object + relative property binding", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      users: [
        { name: "Alice", role: "admin" },
        { name: "Bob", role: "user" },
      ],
    });
    model.createComputed("/currentUser", ["/users"], (users) => {
      return (users as { name: string; role: string }[])[0];
    });

    const text = new Text();
    text.setModel(model);
    text.placeAt("qunit-fixture");

    text.bindProperty("text", "/currentUser/name");

    setTimeout(() => {
      assert.strictEqual(text.getText(), "Alice", "reads computed sub-path via control");

      model.setProperty("/users", [
        { name: "Carol", role: "admin" },
        { name: "Dave", role: "user" },
      ]);

      setTimeout(() => {
        assert.strictEqual(text.getText(), "Carol", "updates when computed source changes");
        text.destroy();
        model.destroy();
        done();
      }, 50);
    }, 50);
  });

  // =========================================================================
  // List/tree binding computed sub-path edge cases
  // =========================================================================

  QUnit.test("list binding on computed — item property change propagates", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [
        { name: "Alice", active: true },
        { name: "Bob", active: false },
        { name: "Carol", active: true },
      ],
    });
    model.createComputed("/activeItems", ["/items"], (items) => {
      return (items as { name: string; active: boolean }[]).filter((i) => i.active);
    });

    const listBinding = model.bindList("/activeItems");
    let contexts = listBinding.getContexts(0, 10);
    assert.strictEqual(contexts.length, 2, "initially 2 active");
    assert.strictEqual(model.getProperty("name", contexts[0]), "Alice", "first is Alice");

    listBinding.attachChange(() => {
      contexts = listBinding.getContexts(0, 10);
      assert.strictEqual(contexts.length, 3, "now 3 active after Bob becomes active");
      assert.strictEqual(model.getProperty("name", contexts[1]), "Bob", "Bob is now active");
      model.destroy();
      done();
    });

    // Make Bob active
    model.setProperty("/items", [
      { name: "Alice", active: true },
      { name: "Bob", active: true },
      { name: "Carol", active: true },
    ]);
  });

  QUnit.test("list binding on computed — item removal propagates", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [
        { name: "Alice", active: true },
        { name: "Bob", active: true },
        { name: "Carol", active: true },
      ],
    });
    model.createComputed("/activeItems", ["/items"], (items) => {
      return (items as { name: string; active: boolean }[]).filter((i) => i.active);
    });

    const listBinding = model.bindList("/activeItems");
    listBinding.getContexts(0, 10);
    assert.strictEqual(listBinding.getLength(), 3, "initially 3");

    listBinding.attachChange(() => {
      listBinding.getContexts(0, 10);
      assert.strictEqual(listBinding.getLength(), 2, "down to 2 after Bob deactivated");
      model.destroy();
      done();
    });

    model.setProperty("/items", [
      { name: "Alice", active: true },
      { name: "Bob", active: false },
      { name: "Carol", active: true },
    ]);
  });

  QUnit.test("list binding on computed — complete list replacement", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [{ name: "Alice" }, { name: "Bob" }],
    });
    model.createComputed("/sorted", ["/items"], (items) => {
      return [...(items as { name: string }[])].toSorted((a, b) => a.name.localeCompare(b.name));
    });

    const listBinding = model.bindList("/sorted");
    let contexts = listBinding.getContexts(0, 10);
    assert.strictEqual(model.getProperty("name", contexts[0]), "Alice", "sorted: Alice first");

    listBinding.attachChange(() => {
      contexts = listBinding.getContexts(0, 10);
      assert.strictEqual(contexts.length, 3, "3 items after replacement");
      assert.strictEqual(model.getProperty("name", contexts[0]), "Carol", "sorted: Carol first");
      assert.strictEqual(model.getProperty("name", contexts[1]), "Dave", "sorted: Dave second");
      assert.strictEqual(model.getProperty("name", contexts[2]), "Eve", "sorted: Eve third");
      model.destroy();
      done();
    });

    model.setProperty("/items", [{ name: "Eve" }, { name: "Carol" }, { name: "Dave" }]);
  });

  QUnit.test("property binding on computed list item sub-path updates", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [
        { name: "Alice", score: 10 },
        { name: "Bob", score: 20 },
      ],
    });
    model.createComputed("/topScorer", ["/items"], (items) => {
      const arr = items as { name: string; score: number }[];
      return arr.reduce((best, cur) => (cur.score > best.score ? cur : best), arr[0]);
    });

    const binding = model.bindProperty("/topScorer/name");
    assert.strictEqual(binding.getValue(), "Bob", "initial top scorer is Bob");

    model.setProperty("/items", [
      { name: "Alice", score: 100 },
      { name: "Bob", score: 20 },
    ]);

    setTimeout(() => {
      assert.strictEqual(binding.getValue(), "Alice", "top scorer changes to Alice");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("tree binding on computed — sub-path getProperty on nodes", (assert) => {
    const model = new SignalModel({
      rawNodes: [
        { name: "Root", children: [{ name: "Child A", children: [] }] },
        { name: "Leaf", children: [] },
      ],
    });
    model.createComputed("/tree", ["/rawNodes"], (nodes) => {
      return nodes as { name: string; children: unknown[] }[];
    });

    const treeBinding = model.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);
    const roots = treeBinding.getRootContexts();
    assert.strictEqual(roots.length, 2, "2 root nodes");
    assert.strictEqual(model.getProperty("name", roots[0]), "Root", "first root is Root");
    assert.strictEqual(model.getProperty("name", roots[1]), "Leaf", "second root is Leaf");

    const children = treeBinding.getNodeContexts(roots[0]);
    assert.strictEqual(children.length, 1, "Root has 1 child");
    assert.strictEqual(model.getProperty("name", children[0]), "Child A", "child is Child A");
    model.destroy();
  });

  QUnit.test(
    "sub-path binding re-subscribes when parent computed is redefined with different deps",
    (assert) => {
      const done = assert.async();
      const model = new SignalModel({ x: 1, y: 100 });
      model.createComputed("/c", ["/x"], (x) => ({ name: "x=" + (x as number) }));

      const binding = model.bindProperty("/c/name");
      assert.strictEqual(binding.getValue(), "x=1", "initial value from /x");

      // Redefine with DIFFERENT dependency
      model.removeComputed("/c");
      model.createComputed("/c", ["/y"], (y) => ({ name: "y=" + (y as number) }));

      // Change the NEW dependency — sub-path binding must see it
      model.setProperty("/y", 200);

      setTimeout(() => {
        assert.strictEqual(
          binding.getValue(),
          "y=200",
          "sub-path binding tracks new dependency after redefine",
        );
        model.destroy();
        done();
      }, 50);
    },
  );

  QUnit.test(
    "list binding on computed re-subscribes when parent computed is redefined",
    (assert) => {
      const done = assert.async();
      const model = new SignalModel({ x: [1, 2], y: [10, 20, 30] });
      model.createComputed("/list", ["/x"], (x) => x);

      const listBinding = model.bindList("/list");
      assert.strictEqual(listBinding.getContexts(0, 10).length, 2, "initial: 2 items from /x");

      model.removeComputed("/list");
      model.createComputed("/list", ["/y"], (y) => y);

      listBinding.attachChange(() => {
        const contexts = listBinding.getContexts(0, 10);
        assert.strictEqual(contexts.length, 4, "list binding sees 4 items from new /y dependency");
        model.destroy();
        done();
      });

      // Change the NEW dependency — list binding must see it
      model.setProperty("/y", [10, 20, 30, 40]);
    },
  );
});
