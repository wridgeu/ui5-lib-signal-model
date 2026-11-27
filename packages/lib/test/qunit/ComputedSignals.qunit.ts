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

      // Trigger a dependency change -- binding should see the new formula
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

      // Redefine with DIFFERENT dependencies -- the real test.
      // Without re-subscribe, changing /b would never fire the old watcher.
      model.removeComputed("/result");
      model.createComputed("/result", ["/b"], (b) => (b as number) * 2);

      binding.attachChange(() => {
        assert.strictEqual(binding.getValue(), 400, "binding sees new computed (200 * 2 = 400)");
        model.destroy();
        done();
      });

      // Change the NEW dependency -- binding must update
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

    // Make Bob active -- the computed should re-evaluate
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

  QUnit.test("list binding on computed array -- relative getProperty", (assert) => {
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
    assert.deepEqual(
      model.getProperty("/c"),
      { name: "from-computed" },
      "getProperty returns computed value, not data",
    );
    model.destroy();
  });

  QUnit.test("computed returning null -- sub-path returns null", (assert) => {
    const model = new SignalModel({ x: 1 });
    model.createComputed("/nullable", ["/x"], () => null);

    assert.strictEqual(
      model.getProperty("/nullable/anything"),
      null,
      "sub-path of null computed returns null",
    );
    model.destroy();
  });

  QUnit.test("computed returning primitive -- sub-path returns undefined", (assert) => {
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

  QUnit.test("list binding on computed -- item property change propagates", (assert) => {
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

  QUnit.test("list binding on computed -- item removal propagates", (assert) => {
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

  QUnit.test("list binding on computed -- complete list replacement", (assert) => {
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

  QUnit.test("tree binding on computed -- sub-path getProperty on nodes", (assert) => {
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

      // Change the NEW dependency -- sub-path binding must see it
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

      // Change the NEW dependency -- list binding must see it
      model.setProperty("/y", [10, 20, 30, 40]);
    },
  );

  // =========================================================================
  // Resubscription safety -- recursion / reentrant edge cases
  // =========================================================================

  QUnit.test(
    "many sub-path bindings resubscribe without infinite loop on computed redefine",
    (assert) => {
      const done = assert.async();
      const model = new SignalModel({ x: 1, y: 100 });
      model.createComputed("/obj", ["/x"], (x) => ({
        a: "x-a-" + (x as number),
        b: "x-b-" + (x as number),
        c: "x-c-" + (x as number),
      }));

      const bindingA = model.bindProperty("/obj/a");
      const bindingB = model.bindProperty("/obj/b");
      const bindingC = model.bindProperty("/obj/c");

      assert.strictEqual(bindingA.getValue(), "x-a-1", "initial a");
      assert.strictEqual(bindingB.getValue(), "x-b-1", "initial b");
      assert.strictEqual(bindingC.getValue(), "x-c-1", "initial c");

      // Redefine with different deps -- triggers _firePathResubscribe
      // which must snapshot sub-path entries to avoid infinite loop
      model.removeComputed("/obj");
      model.createComputed("/obj", ["/y"], (y) => ({
        a: "y-a-" + (y as number),
        b: "y-b-" + (y as number),
        c: "y-c-" + (y as number),
      }));

      model.setProperty("/y", 200);

      setTimeout(() => {
        assert.strictEqual(bindingA.getValue(), "y-a-200", "a tracks new dep");
        assert.strictEqual(bindingB.getValue(), "y-b-200", "b tracks new dep");
        assert.strictEqual(bindingC.getValue(), "y-c-200", "c tracks new dep");
        model.destroy();
        done();
      }, 50);
    },
  );

  QUnit.test(
    "chained computed redefine -- both levels redefined, downstream binding updates",
    (assert) => {
      const done = assert.async();
      const model = new SignalModel({ x: 5, y: 100 });

      model.createComputed("/base", ["/x"], (x) => (x as number) * 2);
      model.createComputed("/derived", ["/base"], (b) => (b as number) + 1);

      const binding = model.bindProperty("/derived");
      assert.strictEqual(binding.getValue(), 11, "initial: (5*2)+1 = 11");

      // Redefine both levels -- each removeComputed+createComputed triggers
      // _firePathResubscribe so bindings re-wire to the new signal objects
      model.removeComputed("/derived");
      model.removeComputed("/base");
      model.createComputed("/base", ["/y"], (y) => (y as number) * 3);
      model.createComputed("/derived", ["/base"], (b) => (b as number) + 1);

      model.setProperty("/y", 10);

      setTimeout(() => {
        assert.strictEqual(binding.getValue(), 31, "derived sees new base: (10*3)+1 = 31");
        model.destroy();
        done();
      }, 50);
    },
  );

  QUnit.test("rapid successive redefine does not corrupt binding state", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ a: 1, b: 2, c: 3 });
    model.createComputed("/val", ["/a"], (a) => "a=" + (a as number));

    const binding = model.bindProperty("/val");
    assert.strictEqual(binding.getValue(), "a=1", "initial");

    // Rapid redefine -- 3 times without waiting
    model.removeComputed("/val");
    model.createComputed("/val", ["/b"], (b) => "b=" + (b as number));

    model.removeComputed("/val");
    model.createComputed("/val", ["/c"], (c) => "c=" + (c as number));

    model.setProperty("/c", 99);

    setTimeout(() => {
      assert.strictEqual(binding.getValue(), "c=99", "binding tracks final definition");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("sub-path binding survives rapid redefine without stale values", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ a: 1, b: 2, c: 3 });
    model.createComputed("/obj", ["/a"], (a) => ({ val: "a=" + (a as number) }));

    const binding = model.bindProperty("/obj/val");
    assert.strictEqual(binding.getValue(), "a=1", "initial");

    // Rapid redefine with sub-path binding
    model.removeComputed("/obj");
    model.createComputed("/obj", ["/b"], (b) => ({ val: "b=" + (b as number) }));

    model.removeComputed("/obj");
    model.createComputed("/obj", ["/c"], (c) => ({ val: "c=" + (c as number) }));

    model.setProperty("/c", 42);

    setTimeout(() => {
      assert.strictEqual(binding.getValue(), "c=42", "sub-path tracks final definition");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test(
    "chained computed over object-returning computed updates on in-place child mutation",
    (assert) => {
      const done = assert.async();
      const model = new SignalModel({
        items: [{ name: "Alice" }],
      });
      // First computed returns the same object reference (items[0])
      model.createComputed("/first", ["/items"], (items) => (items as { name: string }[])[0]);
      // Second computed reads a property of that object
      model.createComputed("/firstName", ["/first"], (first) => (first as { name: string }).name);

      const binding = model.bindProperty("/firstName");
      assert.strictEqual(binding.getValue(), "Alice", "initial chained computed value");

      binding.attachChange(() => {
        assert.strictEqual(
          binding.getValue(),
          "Bob",
          "chained computed updated after in-place child mutation",
        );
        model.destroy();
        done();
      });

      // Mutate child in-place: /items[0] reference stays identical
      model.setProperty("/items/0/name", "Bob");
    },
  );

  QUnit.test(
    "throwing computed during flush does not break other bindings and recovers",
    (assert) => {
      const done = assert.async();
      const model = new SignalModel({ x: 1, other: "init" });
      model.createComputed("/risky", ["/x"], (x) => {
        if ((x as number) === 0) {
          throw new Error("division by zero");
        }
        return 100 / (x as number);
      });

      const riskyBinding = model.bindProperty("/risky");
      const otherBinding = model.bindProperty("/other");
      assert.strictEqual(riskyBinding.getValue(), 100, "initial risky value");

      let otherUpdates = 0;
      otherBinding.attachChange(() => otherUpdates++);

      // Trigger error in /risky AND a valid update in /other in the same flush
      model.setProperty("/x", 0);
      model.setProperty("/other", "updated");

      setTimeout(() => {
        assert.strictEqual(
          otherUpdates,
          1,
          "unrelated binding still updated despite throwing sibling",
        );
        assert.strictEqual(otherBinding.getValue(), "updated", "other binding has new value");

        // Recover /x to a valid value -- watcher must still be armed
        model.setProperty("/x", 2);

        setTimeout(() => {
          assert.strictEqual(riskyBinding.getValue(), 50, "risky binding recovered after error");
          model.destroy();
          done();
        }, 50);
      }, 50);
    },
  );

  QUnit.test("writing an equal primitive does not re-evaluate dependent computeds", (assert) => {
    const model = new SignalModel({ a: 1 });
    let evaluations = 0;
    model.createComputed("/double", ["/a"], (a) => {
      evaluations++;
      return (a as number) * 2;
    });
    model.getProperty("/double");
    const before = evaluations;

    model.setProperty("/a", 1);
    assert.strictEqual(model.getProperty("/double"), 2, "value unchanged");
    assert.strictEqual(evaluations, before, "not re-evaluated for an equal value");

    model.setProperty("/a", 2);
    assert.strictEqual(model.getProperty("/double"), 4, "value updated");
    assert.strictEqual(evaluations, before + 1, "re-evaluated once for a new value");
    model.destroy();
  });

  // Like a throwing formatter on a JSONModel binding, and like Signal.Computed itself:
  // the error reaches the caller instead of turning into a wrong value.
  QUnit.test("reading a failing computed rethrows its error until it recovers", (assert) => {
    const model = new SignalModel({ a: 1 });
    model.createComputed("/checked", ["/a"], (a) => {
      if (a === 2) throw new Error("computed failed");
      return { value: a };
    });

    model.setProperty("/a", 2);
    assert.throws(() => model.getProperty("/checked"), /computed failed/, "getProperty");
    assert.throws(() => model.getProperty("/checked/value"), /computed failed/, "path below it");
    assert.throws(() => model.bindProperty("/checked").getValue(), /computed failed/, "binding");
    assert.strictEqual(model.getProperty("/a"), 2, "other paths are readable");

    model.setProperty("/a", 3);
    assert.strictEqual(model.getProperty("/checked/value"), 3, "readable again");
    model.destroy();
  });

  QUnit.test("createComputed throws and registers nothing if the first run fails", (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ a: 1 });
    const failing = (): never => {
      throw new Error("first run failed");
    };
    assert.throws(() => model.createComputed("/bad", ["/a"], failing), /first run failed/);
    assert.strictEqual(model.getProperty("/bad"), undefined, "no computed at the path");
    model.createComputed("/bad", ["/a"], (a) => a);
    assert.strictEqual(model.getProperty("/bad"), 1, "the path can be defined afterwards");
    model.destroy();
  });

  QUnit.test("binding keeps its value when its computed throws during a flush", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ a: 1 });
    model.createComputed("/checked", ["/a"], (a) => {
      if (a === 2) throw new Error("computed failed");
      return a;
    });
    const binding = model.bindProperty("/checked");
    let changeCount = 0;
    binding.attachChange(() => changeCount++);

    model.setProperty("/a", 2);

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "no change event for a failed read");
      assert.strictEqual(binding.getValue(), 1, "last good value kept");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test(
    "a binding from before a computed above its path follows that computed",
    async (assert) => {
      const model = new SignalModel<Record<string, unknown>>({ a: 1, c: { name: "raw" } });
      const binding = model.bindProperty("/c/name");
      let fired = 0;
      binding.attachChange(() => fired++);
      model.createComputed("/c", ["/a"], (a) => ({ name: `computed ${String(a)}` }));
      await Promise.resolve();
      assert.strictEqual(binding.getValue(), "computed 1", "the computed's value, without a write");
      assert.strictEqual(fired, 1, "change fired once");
      model.setProperty("/a", 2);
      await Promise.resolve();
      assert.strictEqual(binding.getValue(), "computed 2", "follows the computed's input");
      model.destroy();
    },
  );

  QUnit.test("bindings follow the data again after removeComputed", async (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ a: 1 });
    model.createComputed("/c", ["/a"], (a) => ({ name: `computed ${String(a)}` }));
    const at = model.bindProperty("/c");
    const below = model.bindProperty("/c/name");
    const fired = [0, 0];
    at.attachChange(() => fired[0]++);
    below.attachChange(() => fired[1]++);
    model.removeComputed("/c");
    await Promise.resolve();
    assert.deepEqual([at.getValue(), below.getValue()], [undefined, undefined], "no data there");
    assert.deepEqual(fired, [1, 1], "change fired once each");
    model.setProperty("/a", 2);
    await Promise.resolve();
    assert.deepEqual(fired, [1, 1], "the removed computed's input no longer reaches them");
    model.setProperty("/c", { name: "data" });
    await Promise.resolve();
    assert.strictEqual(below.getValue(), "data", "a write to the path does");
    // The path can still be redefined while bindings are on it
    model.setProperty("/c", undefined);
    model.createComputed("/c", ["/a"], (a) => ({ name: `again ${String(a)}` }));
    await Promise.resolve();
    assert.strictEqual(below.getValue(), "again 2", "redefined later");
    model.destroy();
  });

  QUnit.test(
    "a computed follows a computed it depends on when that is redefined",
    async (assert) => {
      const model = new SignalModel<Record<string, unknown>>({ a: 1, x: 10 });
      model.createComputed("/c", ["/a"], (a) => (a as number) * 2);
      model.createComputed("/d", ["/c"], (c) => `d of ${String(c)}`);
      const binding = model.bindProperty("/d");
      let fired = 0;
      binding.attachChange(() => fired++);
      model.removeComputed("/c");
      model.createComputed("/c", ["/x"], (x) => (x as number) + 1);
      await Promise.resolve();
      assert.strictEqual(binding.getValue(), "d of 11", "the new computed's value");
      assert.strictEqual(fired, 1, "change fired once");
      model.setProperty("/x", 20);
      await Promise.resolve();
      assert.strictEqual(binding.getValue(), "d of 21", "follows the new computed's input");
      model.setProperty("/a", 5);
      await Promise.resolve();
      assert.strictEqual(fired, 2, "the old computed's input no longer reaches it");
      model.destroy();
    },
  );

  QUnit.test(
    "a computed follows the data when a computed it depends on is removed",
    async (assert) => {
      const model = new SignalModel<Record<string, unknown>>({ a: 1 });
      model.createComputed("/c", ["/a"], (a) => (a as number) * 2);
      model.createComputed("/d", ["/c"], (c) => `d of ${String(c)}`);
      const binding = model.bindProperty("/d");
      model.removeComputed("/c");
      await Promise.resolve();
      assert.strictEqual(binding.getValue(), "d of undefined", "no data at the path");
      assert.strictEqual(model.getProperty("/d"), "d of undefined", "the model reads the same");
      model.setProperty("/c", 5);
      await Promise.resolve();
      assert.strictEqual(binding.getValue(), "d of 5", "a write to the path reaches it");
      model.createComputed("/c", ["/a"], (a) => (a as number) * 3);
      await Promise.resolve();
      assert.strictEqual(binding.getValue(), "d of 3", "and a computed created there again");
      model.destroy();
    },
  );

  QUnit.test("a list binding follows the data again after removeComputed", async (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ rows: [{ n: 1 }, { n: 2 }] });
    model.createComputed("/list", ["/rows"], (rows) => (rows as object[]).map(() => ({})));
    const list = model.bindList("/list");
    list.attachChange(() => {});
    list.initialize();
    assert.strictEqual(list.getContexts(0, 10).length, 2, "the computed's rows");
    model.removeComputed("/list");
    await Promise.resolve();
    assert.strictEqual(list.getContexts(0, 10).length, 0, "no data at the path");
    model.setProperty("/list", [{}, {}, {}]);
    await Promise.resolve();
    assert.strictEqual(list.getContexts(0, 10).length, 3, "a write to the path reaches it");
    model.destroy();
  });

  QUnit.test("a computed that depends on a path inside a computed follows it", async (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ a: 1, x: "x1" });
    model.createComputed("/c", ["/a"], (a) => ({ name: `n${String(a)}` }));
    model.createComputed("/d", ["/c/name"], (name) => `d of ${String(name)}`);
    const binding = model.bindProperty("/d");
    binding.attachChange(() => {});
    assert.strictEqual(binding.getValue(), "d of n1", "the value inside the computed");
    model.setProperty("/a", 2);
    await Promise.resolve();
    assert.strictEqual(binding.getValue(), "d of n2", "an input of the computed above");
    model.removeComputed("/c");
    model.createComputed("/c", ["/x"], (x) => ({ name: x }));
    await Promise.resolve();
    assert.strictEqual(binding.getValue(), "d of x1", "the computed above redefined");
    model.setProperty("/x", "x2");
    await Promise.resolve();
    assert.strictEqual(binding.getValue(), "d of x2", "the new computed's input");
    model.removeComputed("/c");
    await Promise.resolve();
    assert.strictEqual(binding.getValue(), "d of undefined", "the computed above removed");
    model.setProperty("/c", { name: "data" });
    await Promise.resolve();
    assert.strictEqual(binding.getValue(), "d of data", "a write to the data");
    model.destroy();
  });

  QUnit.test("a computed follows a computed created above its dependency later", async (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ a: 1, c: { name: "n1" } });
    model.createComputed("/d", ["/c/name"], (name) => `d of ${String(name)}`);
    const binding = model.bindProperty("/d");
    binding.attachChange(() => {});
    // The same value as the data held: nothing changes at first
    model.createComputed("/c", ["/a"], (a) => ({ name: `n${String(a)}` }));
    await Promise.resolve();
    assert.strictEqual(binding.getValue(), "d of n1");
    model.setProperty("/a", 2);
    await Promise.resolve();
    assert.strictEqual(binding.getValue(), "d of n2", "follows the computed above");
    model.destroy();
  });

  QUnit.test("computeds that no computed depends on cost no extra signal", (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ a: 1, o: { b: 2 } });
    model.createComputed("/c", ["/a", "/o/b"], (a, b) => (a as number) + (b as number));
    model.createComputed("/e", ["/o/b"], (b) => b);
    // oxlint-disable-next-line typescript/no-explicit-any -- private state of the registry
    const replaced = (model as any).registry.replaced as Map<string, unknown>;
    assert.strictEqual(replaced.size, 0, "none for plain dependencies");
    model.createComputed("/f", ["/c"], (c) => c);
    assert.deepEqual([...replaced.keys()], ["/c"], "one for a computed another one depends on");
    // Redefined while bound: the state signal in between leaves nothing in the path index
    model.createComputed("/o/g", ["/a"], (a) => a);
    model.bindProperty("/o/g").attachChange(() => {});
    for (let i = 0; i < 3; i++) {
      model.removeComputed("/o/g");
      model.createComputed("/o/g", ["/a"], (a) => a);
    }
    // oxlint-disable-next-line typescript/no-explicit-any -- private state of the registry
    const below = (model as any).registry.descendants.get("/o") as string[];
    assert.deepEqual(below, ["/o/b", "/o/g"], "listed once, however often it was replaced");
    model.destroy();
  });

  QUnit.test(
    "a binding shows a redefined computed without a change of its inputs",
    async (assert) => {
      const model = new SignalModel({ a: 5 });
      model.createComputed("/result", ["/a"], (a) => (a as number) + 10);
      const binding = model.bindProperty("/result");
      let fired = 0;
      binding.attachChange(() => fired++);
      model.removeComputed("/result");
      model.createComputed("/result", ["/a"], (a) => (a as number) * 2);
      await Promise.resolve();
      assert.strictEqual(binding.getValue(), 10, "the new formula");
      assert.strictEqual(fired, 1, "change fired once");
      model.destroy();
    },
  );

  QUnit.test("a redefinition whose first run throws changes nothing", async (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ a: 1, x: null, total: 0 });
    model.createComputed("/total", ["/a"], (a) => a);
    model.createComputed("/double", ["/total"], (total) => (total as number) * 2);
    const binding = model.bindProperty("/total");
    const dependent = model.bindProperty("/double");
    binding.attachChange(() => {});
    dependent.attachChange(() => {});
    model.removeComputed("/total");
    assert.throws(
      () => model.createComputed("/total", ["/x"], (x) => (x as { a: number }).a),
      TypeError,
    );
    model.setProperty("/total", 5);
    await Promise.resolve();
    assert.strictEqual(binding.getValue(), 5, "the binding still follows the data");
    assert.strictEqual(dependent.getValue(), 10, "and so does a computed that depends on the path");
    model.createComputed("/total", ["/a"], (a) => (a as number) + 1);
    await Promise.resolve();
    assert.strictEqual(binding.getValue(), 2, "a later redefinition works");
    assert.strictEqual(dependent.getValue(), 4);
    model.destroy();
  });

  QUnit.test(
    "a computed below a removed computed it depends on follows the data",
    async (assert) => {
      const model = new SignalModel<Record<string, unknown>>({ a: 1 });
      model.createComputed("/r", ["/a"], (a) => ({ k: a }));
      model.createComputed("/r/d", ["/r"], (r) => ({
        name: (r as { k?: unknown } | undefined)?.k,
      }));
      model.createComputed("/z", ["/r/d/name"], (name) => name);
      const binding = model.bindProperty("/z");
      binding.attachChange(() => {});
      assert.strictEqual(binding.getValue(), 1);
      model.removeComputed("/r");
      model.setProperty("/r", { k: 5 });
      await Promise.resolve();
      assert.deepEqual(model.getProperty("/r/d"), { name: 5 }, "runs again with the data");
      assert.strictEqual(binding.getValue(), 5, "and so does what depends on it");
      model.destroy();
    },
  );

  QUnit.test("a removed computed that nothing depends on leaves no signal", (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ a: 1 });
    model.createComputed("/c", ["/a"], (a) => a);
    model.removeComputed("/c");
    // oxlint-disable-next-line typescript/no-explicit-any -- private state of the registry
    const signals = (model as any).registry.signals as Map<string, unknown>;
    assert.deepEqual([...signals.keys()], [], "not for its dependency either");
    model.destroy();
  });

  QUnit.test("a path a computed depends on is plain data for createComputed", (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ a: 1 });
    model.createComputed("/b", ["/a"], (a) => a);
    assert.throws(() => model.createComputed("/a", [], () => 7), /already holds raw data/);
    model.destroy();

    const ordered = new SignalModel<Record<string, unknown>>({});
    ordered.createComputed("/a", [], () => 7);
    ordered.createComputed("/b", ["/a"], (a) => a);
    assert.strictEqual(ordered.getProperty("/b"), 7, "the computed that is depended on first");
    ordered.destroy();
  });

  QUnit.test(
    "list and tree bindings follow a computed created or removed above them",
    async (assert) => {
      const nodes = (name: string): object[] => [{ name, children: [{ name: `${name} child` }] }];
      const model = new SignalModel<Record<string, unknown>>({
        pick: "a",
        a: nodes("a"),
        b: nodes("b"),
        view: { nodes: nodes("data") },
      });
      const list = model.bindList("/view/nodes");
      const tree = model.bindTree("/view/nodes", undefined, [], { arrayNames: ["children"] }, []);
      list.attachChange(() => {});
      tree.attachChange(() => {});
      const shown = (): string =>
        [list.getContexts(0, 10), tree.getRootContexts(0, 10)]
          .map((contexts) => String(contexts[0]?.getProperty("name")))
          .join();
      assert.strictEqual(shown(), "data,data");
      model.createComputed("/view", ["/pick", "/a", "/b"], (pick, a, b) => ({
        nodes: pick === "a" ? a : b,
      }));
      await Promise.resolve();
      assert.strictEqual(shown(), "a,a", "the computed created above them");
      model.setProperty("/pick", "b");
      await Promise.resolve();
      assert.strictEqual(shown(), "b,b", "an input of the computed");
      model.removeComputed("/view");
      await Promise.resolve();
      assert.strictEqual(shown(), "data,data", "the data again");
      model.setProperty("/view/nodes", nodes("written"));
      await Promise.resolve();
      assert.strictEqual(shown(), "written,written", "and writes to it");
      model.destroy();
    },
  );

  QUnit.test("a createComputed that fails leaves no signal for its dependencies", (assert) => {
    const model = new SignalModel({ a: 1, b: 2 });
    const signals = (model as unknown as { registry: { signals: Map<string, unknown> } }).registry
      .signals;
    model.getSignal("/a");
    assert.throws(() =>
      model.createComputed("/c", ["/a", "/b"], () => {
        throw new Error("first run");
      }),
    );
    assert.deepEqual([...signals.keys()], ["/a"], "only the signal that was there before");
    model.destroy();
  });

  QUnit.test(
    "a computed binding recovers from a refresh() that a change handler broke off",
    async (assert) => {
      const model = new SignalModel<Record<string, number>>({ x: 1, y: 1 });
      model.createComputed("/c", ["/y"], (y) => (y as number) * 10);
      const first = model.bindProperty("/x");
      first.initialize();
      first.attachChange(() => {
        throw new Error("handler");
      });
      const computed = model.bindProperty("/c");
      computed.initialize();
      computed.attachChange(() => {});
      model.getData().x = 2;
      model.getData().y = 2;
      assert.throws(() => model.refresh(), /handler/);
      model.setProperty("/y", 3);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(computed.getValue(), 30, "it follows the next write");
      model.destroy();
    },
  );

  QUnit.test(
    "refresh() of a binding does not run a computed on an unchanged object",
    async (assert) => {
      const model = new SignalModel({ o: { a: 1 } });
      model.createComputed("/c", ["/o"], (o) => ({ a: (o as { a: number }).a }));
      const binding = model.bindProperty("/o");
      const computed = model.bindProperty("/c");
      binding.initialize();
      computed.initialize();
      let events = 0;
      binding.attachChange(() => {});
      computed.attachChange(() => events++);
      binding.refresh();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(events, 0);
      model.destroy();
    },
  );

  QUnit.test("a removed computed leaves no signal for its dependencies", async (assert) => {
    const model = new SignalModel({ a: 1, b: 2 });
    const signals = (model as unknown as { registry: { signals: Map<string, unknown> } }).registry
      .signals;
    model.createComputed("/sum", ["/a", "/b"], (a, b) => (a as number) + (b as number));
    model.createComputed("/double", ["/a"], (a) => (a as number) * 2);
    model.removeComputed("/sum");
    assert.deepEqual([...signals.keys()], ["/a"], "/a is still read by the other computed");
    const binding = model.bindProperty("/double");
    binding.initialize();
    binding.attachChange(() => {});
    model.setProperty("/a", 5);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(binding.getValue(), 10, "which still follows it");
    binding.destroy();
    model.removeComputed("/double");
    assert.deepEqual([...signals.keys()], []);
    model.destroy();
  });

  QUnit.test(
    "the state signal of a removed computed goes with the computeds that read it",
    (assert) => {
      const model = new SignalModel<Record<string, unknown>>({ a: 1 });
      const signals = (model as unknown as { registry: { signals: Map<string, unknown> } }).registry
        .signals;
      model.createComputed("/c", ["/a"], (a) => a);
      model.createComputed("/d", ["/c"], (c) => c);
      model.createComputed("/e", ["/c"], (c) => c);
      model.removeComputed("/c");
      assert.deepEqual([...signals.keys()], ["/c"], "what /d and /e follow now");
      model.setProperty("/c", 5);
      assert.deepEqual([model.getProperty("/d"), model.getProperty("/e")], [5, 5]);
      model.removeComputed("/d");
      assert.deepEqual([...signals.keys()], ["/c"], "/e still reads it");
      model.removeComputed("/e");
      assert.deepEqual([...signals.keys()], []);
      model.destroy();
    },
  );

  QUnit.test("nothing is kept for a removed computed once nothing needs it", (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ a: 1 });
    const registry = (
      model as unknown as {
        registry: {
          released: Set<string>;
          replaced: Map<string, unknown>;
          signals: Map<string, unknown>;
        };
      }
    ).registry;
    const kept = (): number[] => [
      registry.released.size,
      registry.replaced.size,
      registry.signals.size,
    ];
    for (let i = 0; i < 20; i++) {
      model.createComputed(`/c${i}`, ["/a"], (a) => a);
      model.createComputed(`/d${i}`, [`/c${i}`], (c) => c);
      model.createComputed(`/e${i}`, [`/c${i}/x`], (x) => x);
      model.removeComputed(`/c${i}`);
      model.removeComputed(`/d${i}`);
      model.removeComputed(`/e${i}`);
    }
    assert.deepEqual(kept(), [0, 0, 0], "computeds and their readers created and removed");

    // Read only below its path: no state signal is needed at the path itself
    model.createComputed("/c", ["/a"], () => ({ x: 1 }));
    model.createComputed("/inner", ["/c/x"], (x) => x);
    model.removeComputed("/c");
    assert.deepEqual([...registry.signals.keys()], ["/c/x"]);
    model.removeComputed("/inner");

    // A reader that stays is still told when the path gets a computed again
    model.createComputed("/c", ["/a"], (a) => a);
    model.createComputed("/stays", ["/c"], (c) => c);
    model.createComputed("/goes", ["/c"], (c) => c);
    model.removeComputed("/c");
    // Read now, so that it depends on what the registry keeps for the readers of /c
    assert.strictEqual(model.getProperty("/stays"), undefined, "no data at /c");
    model.removeComputed("/goes");
    model.createComputed("/c", ["/a"], (a) => (a as number) * 10);
    assert.strictEqual(model.getProperty("/stays"), 10);
    model.removeComputed("/stays");
    model.removeComputed("/c");
    assert.deepEqual(kept(), [0, 0, 0]);

    model.createComputed("/c", ["/a"], (a) => a);
    const binding = model.bindProperty("/c");
    binding.initialize();
    model.removeComputed("/c");
    model.createComputed("/c", ["/a"], (a) => (a as number) + 1);
    assert.strictEqual(model.getProperty("/c"), 2, "created again while a binding is on the path");
    model.removeComputed("/c");
    binding.destroy();
    assert.deepEqual(kept(), [0, 0, 0], "and forgotten with the last binding");
    model.destroy();
  });

  QUnit.test(
    "a computed removed, created again and removed keeps one pin per reader",
    async (assert) => {
      const model = new SignalModel<Record<string, unknown>>({ a: 1 });
      const deps = ["/c"];
      model.createComputed("/c", ["/a"], (a) => a);
      model.createComputed("/d", deps, (c) => c);
      // The caller's array is not the model's
      deps.length = 0;
      model.removeComputed("/c");
      model.setProperty("/c", 3);
      assert.strictEqual(model.getProperty("/d"), 3, "/d follows the data at /c");
      model.createComputed("/c", ["/a"], (a) => a);
      model.removeComputed("/c");
      model.createComputed("/e", ["/c"], (c) => c);
      model.removeComputed("/d");
      const binding = model.bindProperty("/e");
      binding.initialize();
      binding.attachChange(() => {});
      model.setProperty("/c", 7);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(binding.getValue(), 7, "/e still follows /c after /d is gone");
      model.destroy();
    },
  );

  QUnit.test("a computed that depends on itself is refused", (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ a: 1 });
    assert.throws(() => model.createComputed("/c", ["/c"], (c) => c), /depends on itself/);
    assert.throws(() => model.createComputed("/c", ["/c/x"], (x) => x), /depends on itself/);
    model.createComputed("/k", ["/kk"], (kk) => kk);
    assert.strictEqual(model.getProperty("/k"), undefined, "a path that only starts alike is fine");
    model.createComputed("/c", ["/a"], (a) => a);
    model.removeComputed("/c");
    assert.throws(() => model.createComputed("/c", ["/a", "/c"], (a) => a), /depends on itself/);
    model.createComputed("/c", ["/a"], (a) => a);
    assert.strictEqual(model.getProperty("/c"), 1, "the path is still free for a computed");
    model.destroy();
  });

  QUnit.test("a read below two computeds reads only the closest one", (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ x: 1 });
    let outer = 0;
    model.createComputed("/a", ["/x"], () => {
      outer++;
      return { b: { c: "outer" } };
    });
    model.createComputed("/a/b", ["/x"], (x) => ({ c: x }));
    assert.strictEqual(outer, 1, "created");
    assert.strictEqual(model.getProperty("/a/b/c"), 1);
    model.setProperty("/x", 2);
    assert.strictEqual(model.getProperty("/a/b/c"), 2);
    assert.strictEqual(outer, 1, "the computed above was not read");
    assert.deepEqual(model.getProperty("/a"), { b: { c: "outer" } });
    model.destroy();
  });

  QUnit.test("createComputed: a path no read would find is refused", (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ a: 1 });
    assert.throws(() => model.createComputed("c", ["/a"], (a) => a), /not an absolute path/);
    assert.throws(() => model.createComputed("/c/", ["/a"], (a) => a), /not an absolute path/);
    model.destroy();
  });

  QUnit.test("a failing createComputed leaves nothing for the paths it read", (assert) => {
    const model = new SignalModel<Record<string, unknown>>({ a: 1 });
    model.createComputed("/u", ["/a"], (a) => a);
    const binding = model.bindProperty("/u");
    binding.initialize();
    binding.attachChange(() => {});
    // The binding stays, so the registry remembers that /u was a computed
    model.removeComputed("/u");
    // oxlint-disable-next-line typescript/no-explicit-any -- private state of the registry
    const replaced = (model as any).registry.replaced as Map<string, unknown>;
    assert.throws(
      () =>
        model.createComputed("/bad", ["/u"], () => {
          throw new Error("first run");
        }),
      /first run/,
    );
    assert.notOk(replaced.has("/u"));
    model.destroy();
  });
});
