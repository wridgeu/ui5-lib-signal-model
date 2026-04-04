import SignalModel from "ui5/model/signal/SignalModel";
import JSONModel from "sap/ui/model/json/JSONModel";

/**
 * Tests for various context shapes and path formats.
 * Verifies SignalModel handles edge-case paths the same way as JSONModel.
 */
QUnit.module("Context and Path Shapes", () => {
  // =========================================================================
  // Path shape edge cases
  // =========================================================================

  QUnit.test("relative path without context returns null (parity)", (assert) => {
    const json = new JSONModel({ name: "Alice" });
    const signal = new SignalModel({ name: "Alice" });

    assert.strictEqual(json.getProperty("name"), null, "JSONModel: null");
    assert.strictEqual(signal.getProperty("name"), null, "SignalModel: null (parity)");
    json.destroy();
    signal.destroy();
  });

  QUnit.test("empty string path returns null (parity)", (assert) => {
    const json = new JSONModel({ name: "Alice" });
    const signal = new SignalModel({ name: "Alice" });

    assert.strictEqual(json.getProperty(""), null, "JSONModel: null");
    assert.strictEqual(signal.getProperty(""), null, "SignalModel: null (parity)");
    json.destroy();
    signal.destroy();
  });

  QUnit.test("setProperty with empty string path returns false", (assert) => {
    const json = new JSONModel({ name: "Alice" });
    const signal = new SignalModel({ name: "Alice" });

    const jsonResult = json.setProperty("", "Bob");
    const signalResult = signal.setProperty("", "Bob");

    assert.strictEqual(signalResult, jsonResult, "both return same result for empty path");
    json.destroy();
    signal.destroy();
  });

  QUnit.test("path with trailing slash resolves to parent (parity)", (assert) => {
    const json = new JSONModel({ customer: { name: "Alice" } });
    const signal = new SignalModel({ customer: { name: "Alice" } });

    // resolve() strips trailing slash: "/customer/" → "/customer"
    assert.deepEqual(
      signal.getProperty("/customer/"),
      json.getProperty("/customer/"),
      "trailing slash: parity with JSONModel",
    );
    json.destroy();
    signal.destroy();
  });

  QUnit.test("path with double slashes stops traversal at empty segment (parity)", (assert) => {
    const json = new JSONModel({ customer: { name: "Alice" }, a: { b: { c: "deep" } } });
    const signal = new SignalModel({ customer: { name: "Alice" }, a: { b: { c: "deep" } } });

    // JSONModel stops traversal at empty segments (""  is falsy in while condition).
    // /customer//name stops at /customer, returning the customer object.
    assert.deepEqual(
      signal.getProperty("/customer//name"),
      json.getProperty("/customer//name"),
      "double slash: parity with JSONModel",
    );

    // /a/b//c stops at /a/b, returning the b object
    assert.deepEqual(
      signal.getProperty("/a/b//c"),
      json.getProperty("/a/b//c"),
      "double slash deeper: parity with JSONModel",
    );
    json.destroy();
    signal.destroy();
  });

  QUnit.test("path to array index via setProperty", (assert) => {
    const done = assert.async();
    const initial = { items: [{ name: "A" }, { name: "B" }] };
    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    const binding = signal.bindProperty("/items/0/name");
    let changed = false;
    binding.attachChange(() => {
      changed = true;
    });

    json.setProperty("/items/0/name", "Z");
    signal.setProperty("/items/0/name", "Z");

    assert.deepEqual(
      signal.getData(),
      json.getData(),
      "data matches after array index setProperty",
    );

    setTimeout(() => {
      assert.ok(changed, "binding notified for array index path");
      json.destroy();
      signal.destroy();
      done();
    }, 50);
  });

  QUnit.test("deep array path /a/0/b/1/c", (assert) => {
    const data = {
      a: [{ b: [{ c: "nope" }, { c: "found" }] }],
    };
    const json = new JSONModel(JSON.parse(JSON.stringify(data)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(data)));

    assert.strictEqual(
      json.getProperty("/a/0/b/1/c"),
      "found",
      "JSONModel resolves deep array path",
    );
    assert.strictEqual(
      signal.getProperty("/a/0/b/1/c"),
      json.getProperty("/a/0/b/1/c"),
      "SignalModel matches",
    );

    json.setProperty("/a/0/b/1/c", "updated");
    signal.setProperty("/a/0/b/1/c", "updated");
    assert.deepEqual(signal.getData(), json.getData(), "data matches after deep array set");

    json.destroy();
    signal.destroy();
  });

  // =========================================================================
  // Context shape edge cases
  // =========================================================================

  QUnit.test("bindProperty with relative path and no context — graceful no-op", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    // Relative path, no context — resolvedPath will be undefined
    const binding = model.bindProperty("name");
    // Value should be null since path can't resolve (JSONModel parity)
    assert.strictEqual(binding.getValue(), null, "relative path without context yields null");
    model.destroy();
  });

  QUnit.test("setContext(undefined) removes context and unsubscribes", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [{ name: "Alice" }, { name: "Bob" }],
    });
    const listBinding = model.bindList("/items");
    const contexts = listBinding.getContexts(0, 10);

    const binding = model.bindProperty("name", contexts[0]);
    assert.strictEqual(binding.getValue(), "Alice", "initial context resolves");

    // Remove context
    binding.setContext(undefined);

    let changeCount = 0;
    binding.attachChange(() => changeCount++);

    // Changing the old path should NOT fire since binding has no context
    model.setProperty("/items/0/name", "Carol");

    setTimeout(() => {
      assert.strictEqual(changeCount, 0, "no change after context removed");
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("setContext to same context is a no-op", (assert) => {
    const model = new SignalModel({
      items: [{ name: "Alice" }],
    });
    const listBinding = model.bindList("/items");
    const contexts = listBinding.getContexts(0, 10);

    const binding = model.bindProperty("name", contexts[0]);

    let subscribeCount = 0;
    const origSubscribe = binding.subscribe.bind(binding);
    (binding as unknown as Record<string, unknown>).subscribe = () => {
      subscribeCount++;
      origSubscribe();
    };

    // Set same context again
    binding.setContext(contexts[0]);
    assert.strictEqual(subscribeCount, 0, "subscribe not called when context unchanged");

    model.destroy();
  });

  QUnit.test("context pointing to root /", (assert) => {
    const model = new SignalModel({ name: "Alice" });
    const ctx = model.createBindingContext("/");
    assert.ok(ctx, "root context created");
    assert.strictEqual(ctx!.getPath(), "/", "root context path is /");

    const binding = model.bindProperty("name", ctx!);
    assert.strictEqual(binding.getValue(), "Alice", "relative path resolves from root context");
    model.destroy();
  });

  QUnit.test("getProperty with explicit undefined context behaves like omitted", (assert) => {
    const json = new JSONModel({ name: "Alice" });
    const signal = new SignalModel({ name: "Alice" });

    assert.strictEqual(
      signal.getProperty("/name", undefined),
      json.getProperty("/name", undefined),
      "explicit undefined context matches JSONModel",
    );
    json.destroy();
    signal.destroy();
  });

  QUnit.test("setProperty with explicit undefined context behaves like omitted", (assert) => {
    const json = new JSONModel({ name: "Alice" });
    const signal = new SignalModel({ name: "Alice" });

    json.setProperty("/name", "Bob", undefined);
    signal.setProperty("/name", "Bob", undefined);

    assert.deepEqual(signal.getData(), json.getData(), "data matches");
    json.destroy();
    signal.destroy();
  });
});
