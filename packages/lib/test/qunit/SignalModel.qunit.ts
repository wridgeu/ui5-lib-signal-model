import SignalModel from "ui5/model/signal/SignalModel";
import Text from "sap/m/Text";
import VBox from "sap/m/VBox";

QUnit.module(
  "SignalModel",
  {
    afterEach() {
      const fixture = document.getElementById("qunit-fixture");
      if (fixture) fixture.innerHTML = "";
    },
  },
  () => {
    QUnit.test("constructor sets initial data", (assert) => {
      const data = { name: "Alice", age: 28 };
      const model = new SignalModel(data);
      assert.deepEqual(model.getData(), data, "getData returns initial data");
      model.destroy();
    });

    QUnit.test("getProperty returns value at path", (assert) => {
      const model = new SignalModel({ customer: { name: "Alice" } });
      assert.strictEqual(model.getProperty("/customer/name"), "Alice", "nested property");
      model.destroy();
    });

    QUnit.test("getProperty returns undefined for missing path", (assert) => {
      const model = new SignalModel({ name: "Alice" });
      assert.strictEqual(model.getProperty("/missing"), undefined, "undefined for missing");
      model.destroy();
    });

    QUnit.test("setProperty updates data and returns true", (assert) => {
      const model = new SignalModel({ name: "Alice" });
      const result = model.setProperty("/name", "Bob");
      assert.ok(result, "returns true on success");
      assert.strictEqual(model.getProperty("/name"), "Bob", "value updated");
      model.destroy();
    });

    QUnit.test("default: setProperty returns false for nonexistent parent", (assert) => {
      const model = new SignalModel({});
      const result = model.setProperty("/customer/name", "Alice");
      assert.notOk(result, "returns false for nonexistent parent");
      model.destroy();
    });

    QUnit.test("autoCreatePaths: setProperty creates intermediate paths", (assert) => {
      const model = new SignalModel({}, { autoCreatePaths: true });
      model.setProperty("/customer/name", "Alice");
      assert.strictEqual(model.getProperty("/customer/name"), "Alice", "created nested path");
      model.destroy();
    });

    QUnit.test("setProperty at root uses setData", (assert) => {
      const model = new SignalModel<Record<string, unknown>>({ old: true });
      const newData = { new: true };
      model.setProperty("/", newData);
      assert.deepEqual(model.getData(), newData, "root replaced via setData");
      model.destroy();
    });

    QUnit.test("setData replaces all data", (assert) => {
      const model = new SignalModel<Record<string, unknown>>({ name: "Alice" });
      model.setData({ name: "Bob", extra: true });
      assert.strictEqual(model.getProperty("/name"), "Bob", "data replaced");
      assert.strictEqual(model.getProperty("/extra"), true, "new properties available");
      model.destroy();
    });

    QUnit.test("setData with merge preserves existing properties", (assert) => {
      const model = new SignalModel({ name: "Alice", age: 28 });
      model.setData({ age: 30 }, true);
      assert.strictEqual(model.getProperty("/name"), "Alice", "name preserved");
      assert.strictEqual(model.getProperty("/age"), 30, "age updated");
      model.destroy();
    });

    QUnit.test("setData fires all signals on replace", (assert) => {
      const done = assert.async();
      const model = new SignalModel({ name: "Alice", age: 28 });
      const nameBinding = model.bindProperty("/name");
      const ageBinding = model.bindProperty("/age");
      let nameChanged = false;
      let ageChanged = false;

      nameBinding.attachChange(() => {
        nameChanged = true;
      });
      ageBinding.attachChange(() => {
        ageChanged = true;
      });

      model.setData({ name: "Bob", age: 30 });

      setTimeout(() => {
        assert.ok(nameChanged, "name binding notified");
        assert.ok(ageChanged, "age binding notified");
        model.destroy();
        done();
      }, 50);
    });

    QUnit.test("setData with merge only fires changed signals", (assert) => {
      const done = assert.async();
      const model = new SignalModel({ name: "Alice", age: 28 });
      const nameBinding = model.bindProperty("/name");
      const ageBinding = model.bindProperty("/age");
      let nameChanged = false;
      let ageChanged = false;

      nameBinding.attachChange(() => {
        nameChanged = true;
      });
      ageBinding.attachChange(() => {
        ageChanged = true;
      });

      model.setData({ age: 30 }, true);

      setTimeout(() => {
        assert.notOk(nameChanged, "name binding NOT notified");
        assert.ok(ageChanged, "age binding notified");
        model.destroy();
        done();
      }, 50);
    });

    QUnit.test("bindProperty returns a SignalPropertyBinding", (assert) => {
      const model = new SignalModel({ name: "Alice" });
      const binding = model.bindProperty("/name");
      assert.ok(binding, "binding created");
      assert.strictEqual(binding.getValue(), "Alice", "binding has correct value");
      model.destroy();
    });

    QUnit.test("checkUpdate without force is a no-op", (assert) => {
      const done = assert.async();
      const model = new SignalModel({ name: "Alice" });
      const binding = model.bindProperty("/name");
      let changeCount = 0;

      binding.attachChange(() => changeCount++);
      model.checkUpdate();

      setTimeout(() => {
        assert.strictEqual(changeCount, 0, "no binding notification from checkUpdate()");
        model.destroy();
        done();
      }, 50);
    });

    QUnit.test("getSignal returns the signal for a path", (assert) => {
      const model = new SignalModel({ name: "Alice" });
      model.bindProperty("/name");
      const signal = model.getSignal("/name");
      assert.ok(signal, "signal exists");
      assert.strictEqual(signal.get(), "Alice", "signal has correct value");
      model.destroy();
    });

    QUnit.test("getSignal creates signal on demand without prior bind", (assert) => {
      const model = new SignalModel({ name: "Alice" });
      const signal = model.getSignal("/name");
      assert.ok(signal, "signal created on demand");
      assert.strictEqual(signal.get(), "Alice", "signal has correct value");
      model.destroy();
    });

    QUnit.test("parent path signals fire on leaf write", (assert) => {
      const done = assert.async();
      const model = new SignalModel({ customer: { name: "Alice", age: 28 } });
      const customerBinding = model.bindProperty("/customer");
      let customerChanged = false;

      customerBinding.attachChange(() => {
        customerChanged = true;
      });

      model.setProperty("/customer/name", "Bob");

      setTimeout(() => {
        assert.ok(customerChanged, "parent binding notified on child change");
        model.destroy();
        done();
      }, 50);
    });

    QUnit.test("branch replace fires all child signals", (assert) => {
      const done = assert.async();
      const model = new SignalModel({ customer: { name: "Alice", age: 28 } });
      const nameBinding = model.bindProperty("/customer/name");
      const ageBinding = model.bindProperty("/customer/age");
      let nameChanged = false;
      let ageChanged = false;

      nameBinding.attachChange(() => {
        nameChanged = true;
      });
      ageBinding.attachChange(() => {
        ageChanged = true;
      });

      model.setProperty("/customer", { name: "Bob", age: 30 });

      setTimeout(() => {
        assert.ok(nameChanged, "name binding notified on branch replace");
        assert.ok(ageChanged, "age binding notified on branch replace");
        model.destroy();
        done();
      }, 50);
    });

    QUnit.test("replacing object with primitive notifies child bindings", (assert) => {
      const done = assert.async();
      const model = new SignalModel({ customer: { name: "Alice", age: 28 } });
      const nameBinding = model.bindProperty("/customer/name");
      let nameChanged = false;

      nameBinding.attachChange(() => {
        nameChanged = true;
      });

      // Replace the object at /customer with a primitive
      model.setProperty("/customer", "deleted");

      setTimeout(() => {
        assert.ok(nameChanged, "child binding notified when parent becomes primitive");
        model.destroy();
        done();
      }, 50);
    });

    QUnit.test("setData merge invalidates root signal", (assert) => {
      const done = assert.async();
      const model = new SignalModel({ name: "Alice", age: 28 });
      const rootBinding = model.bindProperty("/");
      let rootChanged = false;

      rootBinding.attachChange(() => {
        rootChanged = true;
      });

      model.setData({ age: 30 }, true);

      setTimeout(() => {
        assert.ok(rootChanged, "root binding notified on merge");
        model.destroy();
        done();
      }, 50);
    });

    QUnit.test("destroy cleans up registry", (assert) => {
      const done = assert.async();
      const model = new SignalModel({ name: "Alice" });
      const binding = model.bindProperty("/name");
      let changeCount = 0;

      // Verify binding is wired up before we test destroy
      assert.strictEqual(binding.getValue(), "Alice", "binding has initial value");

      binding.attachChange(() => changeCount++);
      model.destroy();

      // After destroy, setting property should not notify binding
      // (registry is cleared, signals no longer exist).
      // setProperty may throw or silently succeed -- either is acceptable.
      // The key assertion is that changeCount stays 0 regardless.
      let threw = false;
      try {
        model.setProperty("/name", "Bob");
      } catch {
        threw = true;
      }

      setTimeout(() => {
        assert.strictEqual(changeCount, 0, "no change events after destroy");
        if (!threw) {
          assert.ok(true, "setProperty did not throw -- cleanup prevented notification");
        }
        done();
      }, 50);
    });

    // =========================================================================
    // setJSON / getJSON (JSONModel parity)
    // =========================================================================

    QUnit.test("getJSON returns model data as JSON string", (assert) => {
      const model = new SignalModel({ name: "Alice", age: 28 });
      const json = model.getJSON();
      assert.deepEqual(JSON.parse(json), { name: "Alice", age: 28 }, "getJSON round-trips");
      model.destroy();
    });

    QUnit.test("setJSON parses string and replaces model data", (assert) => {
      const model = new SignalModel({ name: "Alice" });
      model.setJSON('{"name":"Bob","age":30}');
      assert.strictEqual(model.getProperty("/name"), "Bob", "name replaced");
      assert.strictEqual(model.getProperty("/age"), 30, "age set");
      model.destroy();
    });

    QUnit.test("setJSON with merge preserves existing data", (assert) => {
      const model = new SignalModel({ name: "Alice", age: 28 });
      model.setJSON('{"age":30}', true);
      assert.strictEqual(model.getProperty("/name"), "Alice", "name preserved");
      assert.strictEqual(model.getProperty("/age"), 30, "age merged");
      model.destroy();
    });

    QUnit.test("setJSON with invalid JSON does not throw", (assert) => {
      const model = new SignalModel({ name: "Alice" });
      model.setJSON("{ this is not valid }");
      assert.strictEqual(model.getProperty("/name"), "Alice", "data unchanged after invalid JSON");
      model.destroy();
    });

    // =========================================================================
    // getProperty edge cases
    // =========================================================================

    QUnit.test("getProperty with null path returns null (JSONModel parity)", (assert) => {
      const model = new SignalModel({ name: "Alice" });
      // @ts-expect-error -- testing runtime behavior with null path
      const result = model.getProperty(null);
      assert.strictEqual(result, null, "null path returns null");
      model.destroy();
    });

    QUnit.test("getProperty with null path and context returns context node", (assert) => {
      const model = new SignalModel({
        teamMembers: [{ firstName: "Alice" }, { firstName: "Bob" }],
      });
      const ctx = model.createBindingContext("/teamMembers");
      // @ts-expect-error -- testing runtime behavior with null path
      const result = model.getProperty(null, ctx);
      assert.ok(Array.isArray(result), "returns the array at context path");
      assert.strictEqual(
        (result as { firstName: string }[])[0].firstName,
        "Alice",
        "first member is Alice",
      );
      model.destroy();
    });

    // =========================================================================
    // createBindingContext (inherited from ClientModel)
    // =========================================================================

    QUnit.test("createBindingContext returns context for valid path", (assert) => {
      const model = new SignalModel({ customer: { name: "Alice" } });
      const ctx = model.createBindingContext("/customer");
      assert.ok(ctx, "context created");
      assert.strictEqual(ctx!.getPath(), "/customer", "context path is correct");
      assert.strictEqual(
        model.getProperty("name", ctx!),
        "Alice",
        "getProperty with context works",
      );
      model.destroy();
    });

    // =========================================================================
    // setProperty with invalid binding context (JSONModel parity)
    // =========================================================================

    QUnit.test("setProperty with invalid context and relative path returns false", (assert) => {
      const model = new SignalModel({
        teamMembers: { Alice: { firstName: "Alice" } },
      });
      // Create context to a path that does not exist
      const ctx = model.createBindingContext("/teamMembers/NonExistent");
      const result = model.setProperty("firstName", "Peter", ctx!);
      assert.notOk(result, "setProperty returns false for invalid context path");
      model.destroy();
    });

    // =========================================================================
    // Two models on the same control (JSONModel parity)
    // =========================================================================

    QUnit.test("createBindingContext with two models -- child model takes precedence", (assert) => {
      const done = assert.async();
      const parentModel = new SignalModel({
        teamMembers: [{ firstName: "Alice" }],
      });
      const childModel = new SignalModel({
        pets: [{ type: "ape" }, { type: "bird" }],
      });

      const container = new VBox();
      const text = new Text();
      container.addItem(text);

      container.setModel(parentModel);
      container.setBindingContext(parentModel.createBindingContext("/teamMembers")!);

      // Child model overrides on the text control
      text.setModel(childModel);
      text.bindProperty("text", "/pets/0/type");

      assert.strictEqual(text.getText(), "ape", "text reads from child model");

      childModel.setProperty("/pets/0/type", "hamster");

      // Signal-based update fires via microtask, not synchronously
      setTimeout(() => {
        assert.strictEqual(text.getText(), "hamster", "text updates from child model");
        container.destroy();
        childModel.destroy();
        parentModel.destroy();
        done();
      }, 50);
    });

    // =========================================================================
    // Context inheritance (JSONModel parity)
    // =========================================================================

    QUnit.test("context inheritance -- child inherits parent context via model", (assert) => {
      const done = assert.async();
      const model = new SignalModel({
        pets: [{ type: "ape" }, { type: "bird" }],
      });

      const text = new Text();
      text.setModel(model);

      const ctx = model.createBindingContext("/pets");
      text.setBindingContext(ctx!);
      assert.strictEqual(text.getBindingContext()!.getPath(), "/pets", "context set correctly");

      text.bindProperty("text", "0/type");
      assert.strictEqual(text.getText(), "ape", "relative path resolved through context");

      model.setProperty("0/type", "rat", text.getBindingContext()!);

      setTimeout(() => {
        assert.strictEqual(text.getText(), "rat", "text updated via context-relative setProperty");
        text.destroy();
        model.destroy();
        done();
      }, 50);
    });

    // =========================================================================
    // bindElement (JSONModel parity)
    // =========================================================================

    QUnit.test("bindElement resolves relative path against context", (assert) => {
      const done = assert.async();
      const model = new SignalModel({
        data: {
          level1: { text: "L1", level2: { text: "L2" } },
        },
      });

      const container = new VBox();
      const text = new Text();
      container.addItem(text);
      container.setModel(model);
      container.placeAt("qunit-fixture");

      const ctx = model.createBindingContext("/data");
      container.setBindingContext(ctx!);
      text.bindElement("level1");
      assert.strictEqual(
        text.getBindingContext()!.getPath(),
        "/data/level1",
        "bindElement creates combined context path",
      );

      text.bindProperty("text", "text");

      // bindElement triggers async re-subscription; wait for microtask flush
      setTimeout(() => {
        assert.strictEqual(text.getText(), "L1", "text reads from element binding path");

        text.bindElement("level1/level2");

        setTimeout(() => {
          assert.strictEqual(text.getText(), "L2", "deeper bindElement updates text");
          container.destroy();
          model.destroy();
          done();
        }, 50);
      }, 50);
    });

    QUnit.test("bindElement before setBindingContext -- order independent", (assert) => {
      const model = new SignalModel({
        data: {
          level1: { text: "L1", level2: { text: "L2" } },
        },
      });

      const text = new Text();
      text.setModel(model);
      text.placeAt("qunit-fixture");

      // bindElement first, then set context
      text.bindElement("level1");
      const ctx = model.createBindingContext("/data");
      text.setBindingContext(ctx!);
      assert.strictEqual(
        text.getBindingContext()!.getPath(),
        "/data/level1",
        "context resolves even when bindElement is called first",
      );

      text.bindProperty("text", "text");
      assert.strictEqual(text.getText(), "L1", "text reads correctly");

      text.destroy();
      model.destroy();
    });

    // =========================================================================
    // unbindElement context cleanup (issue #8)
    // =========================================================================

    QUnit.test("unbindElement clears stale value from property binding", (assert) => {
      const done = assert.async();
      const model = new SignalModel({
        data: {
          level1: { text: "L1" },
        },
      });

      const container = new VBox();
      const text = new Text();
      container.addItem(text);
      container.setModel(model);
      container.placeAt("qunit-fixture");

      const ctx = model.createBindingContext("/data");
      container.setBindingContext(ctx!);
      text.bindElement("level1");
      text.bindProperty("text", "text");

      setTimeout(() => {
        assert.strictEqual(text.getText(), "L1", "text reads from element binding path");

        (text as any).unbindElement();

        setTimeout(() => {
          // After unbindElement, "text" relative to "/data" → undefined → empty string
          assert.strictEqual(
            text.getText(),
            "",
            "text clears after unbindElement (value at /data/text is undefined)",
          );
          container.destroy();
          model.destroy();
          done();
        }, 50);
      }, 50);
    });

    QUnit.test("unbindElement falls back to parent context", (assert) => {
      const done = assert.async();
      const model = new SignalModel({
        data: {
          text: "from-parent",
          level1: { text: "L1" },
        },
      });

      const container = new VBox();
      const text = new Text();
      container.addItem(text);
      container.setModel(model);
      container.placeAt("qunit-fixture");

      const ctx = model.createBindingContext("/data");
      container.setBindingContext(ctx!);
      text.bindElement("level1");
      text.bindProperty("text", "text");

      setTimeout(() => {
        assert.strictEqual(text.getText(), "L1", "text reads from element binding");

        (text as any).unbindElement();

        setTimeout(() => {
          // After unbindElement, "text" relative to "/data" → "from-parent"
          assert.strictEqual(
            text.getText(),
            "from-parent",
            "text falls back to parent context value",
          );
          container.destroy();
          model.destroy();
          done();
        }, 50);
      }, 50);
    });

    QUnit.test("unbindElement then re-bindElement picks up new path", (assert) => {
      const done = assert.async();
      const model = new SignalModel({
        data: {
          level1: { text: "L1" },
          level2: { text: "L2" },
        },
      });

      const container = new VBox();
      const text = new Text();
      container.addItem(text);
      container.setModel(model);
      container.placeAt("qunit-fixture");

      container.setBindingContext(model.createBindingContext("/data")!);
      text.bindElement("level1");
      text.bindProperty("text", "text");

      setTimeout(() => {
        assert.strictEqual(text.getText(), "L1", "initial");

        (text as any).unbindElement();

        setTimeout(() => {
          assert.strictEqual(text.getText(), "", "cleared after unbind");

          text.bindElement("level2");

          setTimeout(() => {
            assert.strictEqual(text.getText(), "L2", "re-bound to level2");
            container.destroy();
            model.destroy();
            done();
          }, 50);
        }, 50);
      }, 50);
    });

    QUnit.test("setProperty updates binding after unbindElement", (assert) => {
      const done = assert.async();
      const model = new SignalModel({
        data: {
          text: "parent-text",
          level1: { text: "L1" },
        },
      });

      const container = new VBox();
      const text = new Text();
      container.addItem(text);
      container.setModel(model);
      container.placeAt("qunit-fixture");

      container.setBindingContext(model.createBindingContext("/data")!);
      text.bindElement("level1");
      text.bindProperty("text", "text");

      setTimeout(() => {
        assert.strictEqual(text.getText(), "L1", "initial from element binding");

        (text as any).unbindElement();

        setTimeout(() => {
          assert.strictEqual(text.getText(), "parent-text", "falls back to parent context");

          model.setProperty("/data/text", "updated-parent");

          setTimeout(() => {
            assert.strictEqual(
              text.getText(),
              "updated-parent",
              "reacts to setProperty on new path",
            );
            container.destroy();
            model.destroy();
            done();
          }, 50);
        }, 50);
      }, 50);
    });

    // =========================================================================
    // Prototype pollution guards
    // =========================================================================

    QUnit.test("setData merge skips __proto__ keys in payload", (assert) => {
      const model = new SignalModel({ safe: 1 });
      model.setData(JSON.parse('{"__proto__": {"polluted": true}, "safe": 2}'), true);
      assert.strictEqual(model.getProperty("/safe"), 2, "safe key merged");
      assert.strictEqual(
        (Object.prototype as Record<string, unknown>)["polluted"],
        undefined,
        "Object.prototype not polluted via setData merge",
      );
      model.destroy();
    });

    QUnit.test("mergeProperty skips __proto__, constructor, prototype keys", (assert) => {
      const model = new SignalModel({ target: { a: 1 } });
      model.mergeProperty(
        "/target",
        JSON.parse(
          '{"__proto__": {"x": 1}, "constructor": {"y": 2}, "prototype": {"z": 3}, "a": 99}',
        ),
      );
      assert.strictEqual(model.getProperty("/target/a"), 99, "normal key merged");
      assert.strictEqual(
        (Object.prototype as Record<string, unknown>)["x"],
        undefined,
        "__proto__ key skipped",
      );
      model.destroy();
    });

    QUnit.test("setProperty('/') checks computed ancestor before root write", (assert) => {
      const model = new SignalModel({ val: 1 });
      model.createComputed("/", ["/val"], (v) => v);
      const result = model.setProperty("/", { val: 2 });
      assert.strictEqual(result, false, "setProperty('/') blocked by root computed");
      model.removeComputed("/");
      model.destroy();
    });
  },
);
