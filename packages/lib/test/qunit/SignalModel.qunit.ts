import deepClone from "sap/base/util/deepClone";
import deepEqual from "sap/base/util/deepEqual";
import Sorter from "sap/ui/model/Sorter";
import type { Signal } from "signal-polyfill";
import SignalModel from "ui5/model/signal/SignalModel";
import JSONModel from "sap/ui/model/json/JSONModel";
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

    QUnit.test("setData with merge only fires changed signals", (assert) => {
      const done = assert.async();
      const model = new SignalModel({ name: "Alice", age: 28 });
      const nameBinding = model.bindProperty("/name");
      const ageBinding = model.bindProperty("/age");
      let nameChanged = 0;
      let ageChanged = 0;

      nameBinding.attachChange(() => {
        nameChanged++;
      });
      ageBinding.attachChange(() => {
        ageChanged++;
      });

      model.setData({ age: 30 }, true);

      setTimeout(() => {
        assert.strictEqual(nameChanged, 0, "name binding NOT notified");
        assert.strictEqual(ageChanged, 1, "age binding notified");
        model.destroy();
        done();
      }, 50);
    });

    QUnit.test("bindProperty returns a SignalPropertyBinding", (assert) => {
      const model = new SignalModel({ name: "Alice" });
      const binding = model.bindProperty("/name");
      assert.ok(
        binding.isA("ui5.model.signal.SignalPropertyBinding"),
        "is a SignalPropertyBinding",
      );
      assert.strictEqual(binding.getValue(), "Alice", "binding has correct value");
      model.destroy();
    });

    QUnit.test(
      "refresh() picks up data changed without the model, like JSONModel",
      async (assert) => {
        for (const Model of [JSONModel, SignalModel]) {
          const name = Model === JSONModel ? "JSONModel" : "SignalModel";
          const model = new Model({ name: "Alice", list: [{ id: 1 }] });
          const binding = model.bindProperty("/name");
          const list = model.bindList("/list");
          let changes = 0;
          let listChanges = 0;
          binding.attachChange(() => changes++);
          list.attachChange(() => listChanges++);
          binding.initialize();
          list.initialize();
          changes = listChanges = 0;

          const data = model.getData() as { name: string; list: { id: number }[] };
          data.name = "Bob";
          data.list.push({ id: 2 });
          model.refresh();
          assert.strictEqual(binding.getValue(), "Bob", `${name}: value right after refresh()`);
          assert.strictEqual(list.getContexts(0, 10).length, 2, `${name}: list after refresh()`);
          await new Promise((resolve) => setTimeout(resolve, 0));
          assert.strictEqual(
            `${changes}, ${listChanges}`,
            "1, 1",
            `${name}: one change event each`,
          );

          data.name = "Carol";
          model.updateBindings(false);
          assert.strictEqual(binding.getValue(), "Carol", `${name}: updateBindings()`);

          const whole = model.bindProperty("/list");
          let wholeChanges = 0;
          whole.attachChange(() => wholeChanges++);
          whole.initialize();
          wholeChanges = 0;
          data.list.push({ id: 3 });
          model.refresh(true);
          await new Promise((resolve) => setTimeout(resolve, 0));
          assert.strictEqual(wholeChanges, 1, `${name}: one change event for a forced refresh`);
          model.destroy();
        }
      },
    );

    QUnit.test(
      "refresh() compares like JSONModel and keeps what a handler writes",
      async (assert) => {
        for (const Model of [JSONModel, SignalModel]) {
          const name = Model === JSONModel ? "JSONModel" : "SignalModel";
          const model = new Model({ obj: { x: 1 }, list: [{ x: 1 }], a: 1, b: 1 });
          const counts = { obj: 0, list: 0 };
          const obj = model.bindProperty("/obj");
          obj.attachChange(() => counts.obj++);
          obj.initialize();
          const list = model.bindList("/list");
          list.attachChange(() => counts.list++);
          list.initialize();
          // registered before the binding whose handler writes to its path
          const b = model.bindProperty("/b");
          b.attachChange(() => {});
          b.initialize();
          const a = model.bindProperty("/a");
          a.attachChange(() => model.setProperty("/b", 2));
          a.initialize();
          await new Promise((resolve) => setTimeout(resolve, 0));
          counts.obj = counts.list = 0;

          model.refresh();
          await new Promise((resolve) => setTimeout(resolve, 0));
          assert.strictEqual(counts.obj, 0, `${name}: an unchanged object does not fire`);
          assert.strictEqual(counts.list, 0, `${name}: nor does an unchanged list`);

          // a merge that changes nothing, then a row changed without the model
          model.setData({ a: 1 }, true);
          const data = model.getData() as { a: number; list: { x: number }[] };
          data.list[0].x = 2;
          data.a = 3;
          model.refresh();
          await new Promise((resolve) => setTimeout(resolve, 0));
          assert.strictEqual(counts.list, 1, `${name}: the list notices the row`);
          assert.strictEqual(b.getValue(), 2, `${name}: the write of a change handler arrives`);

          // a refresh that finds nothing new in the rows leaves the list as after the merge
          model.setData({ a: 1 }, true);
          model.refresh();
          await new Promise((resolve) => setTimeout(resolve, 0));
          counts.list = 0;
          model.setProperty("/list/0/x", 5);
          await new Promise((resolve) => setTimeout(resolve, 0));
          assert.strictEqual(counts.list, 1, `${name}: the list notices the next row write`);
          model.destroy();
        }
      },
    );

    QUnit.test("a refresh that throws leaves no trace in a merged list", async (assert) => {
      const model = new SignalModel({ list: [{ x: 1 }], a: 1 });
      const list = model.bindList("/list");
      let fired = 0;
      list.attachChange(() => fired++);
      list.initialize();
      const thrower = model.bindProperty("/a");
      const fail = (): never => {
        throw new Error("handler");
      };
      thrower.attachChange(fail);

      model.getData().a = 2;
      assert.throws(() => model.refresh(), /handler/, "the error of the handler");
      thrower.detachChange(fail);
      fired = 0;
      model.setData({ a: 2 }, true);
      model.setProperty("/list/0/x", 1);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(fired, 0, "no change event for a write of the same value");
      model.destroy();
    });

    QUnit.test("a merge of an equal Date into a row is no change for a list", async (assert) => {
      for (const Model of [JSONModel, SignalModel]) {
        const model = new Model({ list: [{ at: new Date(0) }] });
        const list = model.bindList("/list");
        list.initialize();
        let fired = 0;
        list.attachChange(() => fired++);
        const name = Model === JSONModel ? "JSONModel" : "SignalModel";
        model.setData({ list: [{ at: new Date(0) }] }, true);
        model.refresh();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.strictEqual(fired, 0, `${name}: an equal Date`);
        model.setData({ list: [{ at: new Date(1) }] }, true);
        model.refresh();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.strictEqual(fired, 1, `${name}: another Date`);
        model.destroy();
      }
    });

    QUnit.test("a merged list fires at a refresh only for a changed row", async (assert) => {
      for (const Model of [JSONModel, SignalModel]) {
        const name = Model === JSONModel ? "JSONModel" : "SignalModel";
        const model = new Model({ list: [{ x: 1 }], a: 1 });
        const list = model.bindList("/list");
        let fired = 0;
        list.attachChange(() => fired++);
        list.initialize();
        model.setData({ a: 2 }, true);
        model.refresh();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.strictEqual(fired, 1, `${name}: first refresh`);

        fired = 0;
        model.refresh();
        model.refresh();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.strictEqual(fired, 0, `${name}: not at the next ones`);

        (model.getData() as { list: { x: number }[] }).list[0].x = 2;
        model.refresh();
        model.refresh();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.strictEqual(fired, 1, `${name}: once for a row changed without the model`);

        // the rows of the first merge are kept over a second one
        fired = 0;
        model.setData({ a: 3 }, true);
        (model.getData() as { list: { x: number }[] }).list[0].x = 3;
        model.setData({ a: 4 }, true);
        model.refresh();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.strictEqual(fired, 1, `${name}: a change between two merges`);
        model.destroy();
      }
    });

    QUnit.test("observed data: a merge updates bindings once it is complete", async (assert) => {
      assert.strictEqual(
        new SignalModel({ a: 1 }, null as unknown as undefined).getProperty("/a"),
        1,
        "null as options is accepted",
      );
      for (const Model of [JSONModel, SignalModel]) {
        const name = Model === JSONModel ? "JSONModel" : "SignalModel";
        const model = new Model({ items: [{ name: "b" }, { name: "a" }], a: 1, b: 1 }, true);
        const list = model.bindList("/items", undefined, new Sorter("name"));
        let fired = 0;
        list.attachChange(() => fired++);
        list.initialize();
        const seen: string[] = [];
        const a = model.bindProperty("/a");
        a.attachChange(() =>
          seen.push(`a=${model.getProperty("/a")} b=${model.getProperty("/b")}`),
        );
        a.initialize();
        seen.length = fired = 0;

        model.setData({ items: [{ name: "z" }], a: 2, b: 2 }, true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.deepEqual(seen, ["a=2 b=2"], `${name}: a handler sees the whole merge`);
        assert.strictEqual(
          `${list
            .getContexts()
            .map((context) => context.getPath())
            .join(" ")}, ${fired}`,
          "/items/1 /items/0, 1",
          `${name}: a sorted list sorts again, once`,
        );
        model.destroy();
      }
    });

    QUnit.test("refresh() updates a binding on a computed once", async (assert) => {
      const model = new SignalModel({ price: 2 });
      model.createComputed("/pair", ["/price"], (price) => ({ double: (price as number) * 2 }));
      const binding = model.bindProperty("/pair");
      let changes = 0;
      binding.attachChange(() => changes++);
      binding.initialize();
      changes = 0;

      model.getData().price = 3;
      model.refresh();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(binding.getValue(), { double: 6 }, "the new value");
      assert.strictEqual(changes, 1, "one change event");
      model.destroy();
    });

    QUnit.test(
      "the observe option updates bindings on assignment, like bObserve",
      async (assert) => {
        for (const model of [
          new JSONModel({ name: "a", obj: { x: 1 }, list: [{ x: 1 }] }, true),
          new SignalModel({ name: "a", obj: { x: 1 }, list: [{ x: 1 }] }, true),
          new SignalModel({ name: "a", obj: { x: 1 }, list: [{ x: 1 }] }, { observe: true }),
        ]) {
          const label = model instanceof JSONModel ? "JSONModel" : "SignalModel";
          const fired: string[] = [];
          const bindings = ["/name", "/obj", "/obj/x", "/list/0/x"].map((path) => {
            const binding = model.bindProperty(path);
            binding.attachChange(() => fired.push(path));
            binding.initialize();
            return binding;
          });
          fired.length = 0;
          const data = model.getData() as {
            name: string;
            obj: { x: number };
            list: { x: number }[];
          };

          data.name = "b";
          data.obj.x = 2;
          data.list[0].x = 3;
          assert.deepEqual(
            bindings.map((binding) => binding.getValue() as unknown),
            ["b", data.obj, 2, 3],
            `${label}: values right after the assignments`,
          );
          data.obj = { x: 4 };
          assert.strictEqual(bindings[2].getValue(), 4, `${label}: a new object is observed`);
          data.obj.x = 5;
          assert.strictEqual(bindings[2].getValue(), 5, `${label}: also below it`);
          model.setData({ name: "c", obj: { x: 6 }, list: [{ x: 6 }] });
          (model.getData() as typeof data).name = "d";
          assert.strictEqual(bindings[0].getValue(), "d", `${label}: after setData`);
          await new Promise((resolve) => setTimeout(resolve, 0));
          assert.deepEqual(
            fired,
            [
              "/name",
              "/obj/x",
              "/list/0/x",
              "/obj",
              "/obj/x",
              "/obj/x",
              "/name",
              "/obj",
              "/obj/x",
              "/list/0/x",
              "/name",
            ],
            `${label}: change events`,
          );
          model.destroy();
        }
      },
    );

    QUnit.test(
      "refresh() brings computeds in line with data changed without the model",
      (assert) => {
        const model = new SignalModel({ price: 2 });
        model.createComputed("/double", ["/price"], (price) => (price as number) * 2);
        (model.getData() as { price: number }).price = 5;
        model.refresh();
        assert.strictEqual(model.getProperty("/double"), 10, "computed sees the new value");
        model.destroy();
      },
    );

    QUnit.test("set() on a state signal writes through the model", async (assert) => {
      const model = new SignalModel({ price: 2, customer: { name: "Alice" } });
      model.createComputed("/double", ["/price"], (price) => (price as number) * 2);
      const binding = model.bindProperty("/price");
      let changes = 0;
      binding.attachChange(() => changes++);
      binding.initialize();
      changes = 0;

      (model.getSignal("/price") as Signal.State<number>).set(5);
      assert.strictEqual(model.getProperty("/price"), 5, "the data");
      assert.strictEqual(model.getSignal("/price").get(), 5, "the signal");
      assert.strictEqual(model.getProperty("/double"), 10, "a computed on it");
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(`${binding.getValue()}, ${changes}`, "5, 1", "the binding, once");

      const name = model.bindProperty("/customer/name");
      name.initialize();
      (model.getSignal("/customer") as Signal.State<{ name: string }>).set({ name: "Bob" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(name.getValue(), "Bob", "a binding below the written path");
      model.destroy();
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
      let customerChanged = 0;

      customerBinding.attachChange(() => {
        customerChanged++;
      });

      model.setProperty("/customer/name", "Bob");

      setTimeout(() => {
        assert.strictEqual(customerChanged, 1, "parent binding notified on child change");
        model.destroy();
        done();
      }, 50);
    });

    QUnit.test("branch replace fires all child signals", (assert) => {
      const done = assert.async();
      const model = new SignalModel({ customer: { name: "Alice", age: 28 } });
      const nameBinding = model.bindProperty("/customer/name");
      const ageBinding = model.bindProperty("/customer/age");
      let nameChanged = 0;
      let ageChanged = 0;

      nameBinding.attachChange(() => {
        nameChanged++;
      });
      ageBinding.attachChange(() => {
        ageChanged++;
      });

      model.setProperty("/customer", { name: "Bob", age: 30 });

      setTimeout(() => {
        assert.strictEqual(nameChanged, 1, "name binding notified on branch replace");
        assert.strictEqual(ageChanged, 1, "age binding notified on branch replace");
        model.destroy();
        done();
      }, 50);
    });

    QUnit.test("replacing object with primitive notifies child bindings", (assert) => {
      const done = assert.async();
      const model = new SignalModel({ customer: { name: "Alice", age: 28 } });
      const nameBinding = model.bindProperty("/customer/name");
      let nameChanged = 0;

      nameBinding.attachChange(() => {
        nameChanged++;
      });

      // Replace the object at /customer with a primitive
      model.setProperty("/customer", "deleted");

      setTimeout(() => {
        assert.strictEqual(nameChanged, 1, "child binding notified when parent becomes primitive");
        model.destroy();
        done();
      }, 50);
    });

    QUnit.test("setData merge invalidates root signal", (assert) => {
      const done = assert.async();
      const model = new SignalModel({ name: "Alice", age: 28 });
      const rootBinding = model.bindProperty("/");
      let rootChanged = 0;

      rootBinding.attachChange(() => {
        rootChanged++;
      });

      model.setData({ age: 30 }, true);

      setTimeout(() => {
        assert.strictEqual(rootChanged, 1, "root binding notified on merge");
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
      let threw = 0;
      try {
        model.setProperty("/name", "Bob");
      } catch {
        threw++;
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

    QUnit.test("setJSON with invalid JSON fires parseError event", (assert) => {
      const model = new SignalModel({ name: "Alice" });
      let errorFired = 0;
      let srcText = "";

      model.attachParseError((event: { getParameter(name: string): unknown }) => {
        errorFired++;
        srcText = event.getParameter("srcText") as string;
      });

      model.setJSON("{ not valid json }");

      assert.strictEqual(errorFired, 1, "parseError event fired for invalid JSON");
      assert.ok(srcText.length > 0, "srcText parameter contains error message");
      assert.strictEqual(
        model.getProperty("/name"),
        "Alice",
        "data NOT updated when JSON is invalid",
      );
      model.destroy();
    });

    QUnit.test("setJSON with valid JSON does not fire parseError", (assert) => {
      const model = new SignalModel({ name: "Alice" });
      let errorFired = 0;

      model.attachParseError(() => {
        errorFired++;
      });

      model.setJSON('{"name":"Bob","age":30}');

      assert.strictEqual(errorFired, 0, "parseError NOT fired for valid JSON");
      assert.strictEqual(model.getProperty("/name"), "Bob", "name updated");
      assert.strictEqual(model.getProperty("/age"), 30, "age set");
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

    QUnit.test("a merge drops keys that hold undefined, like JSONModel", async (assert) => {
      const run = async (Model: typeof JSONModel | typeof SignalModel): Promise<string[]> => {
        const named = Object.assign([1, undefined, 3], { extra: undefined });
        const model = new Model({
          a: undefined,
          b: 1,
          list: [1, undefined, undefined],
          deep: { x: undefined, y: 1 },
          rows: [{ n: 1, gone: undefined }, undefined],
          named,
        });
        const fired: Record<string, number> = { length: 0, rows: 0, deepY: 0, list: 0 };
        const list = model.bindList("/list");
        list.attachChange(() => fired.list++);
        list.initialize();
        const length = model.bindProperty("/list/length");
        length.attachChange(() => fired.length++);
        length.initialize();
        const rows = model.bindList("/rows");
        rows.attachChange(() => fired.rows++);
        rows.initialize();
        const deepY = model.bindProperty("/deep/y");
        deepY.attachChange(() => fired.deepY++);
        deepY.initialize();
        fired.length = fired.rows = fired.deepY = fired.list = 0;
        // JSONModel's merge replaces the data object
        const state = (): string => {
          const data = model.getData() as Record<string, unknown[] & Record<string, unknown>>;
          return JSON.stringify({
            keys: Object.keys(data),
            deep: Object.keys(data.deep),
            list: [data.list.length, length.getValue()],
            rows: [data.rows.length, Object.keys(data.rows[0] as object), rows.getLength()],
            named: [Object.keys(data.named), 1 in data.named],
            fired,
          });
        };
        const log: string[] = [];

        model.setData({ b: 2 }, true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        log.push(state());
        // written again, and merged elsewhere: gone again, at the end of the keys when set
        model.setProperty("/deep/y", undefined);
        model.setProperty("/a", 1);
        model.setData({ b: 3 }, true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        log.push(state());
        model.destroy();
        return log;
      };
      const [json, signal] = [await run(JSONModel), await run(SignalModel)];
      assert.strictEqual(
        signal[0],
        '{"keys":["b","list","deep","rows","named"],"deep":["y"],"list":[1,1],"rows":[1,["n"],1],"named":[["0","2"],false],"fired":{"length":1,"rows":1,"deepY":0,"list":1}}',
        "after the first merge",
      );
      assert.deepEqual(signal, json, "same data and change events as JSONModel");

      const edge = async (Model: typeof JSONModel | typeof SignalModel): Promise<string> => {
        const model = new Model({
          a: undefined,
          odd: Object.assign([1, undefined, undefined], { "1.5": "x" }),
          map: { a: { v: 1 }, b: undefined },
        });
        let fired = 0;
        const map = model.bindList("/map");
        map.attachChange(() => fired++);
        map.initialize();
        // nothing to merge in: the keys go all the same
        model.setData(null as unknown as object, true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const data = model.getData() as { odd: unknown[] };
        // observed: the hole at the end is a property with a getter
        const holey = [1];
        holey.length = 2;
        const observed = new Model({ list: holey }, true);
        observed.setData({ x: 1 } as object, true);
        const state = JSON.stringify([
          Object.keys(data),
          data.odd.length,
          Object.keys(data.odd),
          fired,
          (observed.getData() as { list: unknown[] }).list.length,
        ]);
        model.destroy();
        observed.destroy();
        return state;
      };
      const signalEdge = await edge(SignalModel);
      assert.strictEqual(signalEdge, '[["odd","map"],1,["0","1.5"],1,1]', "edge cases");
      assert.strictEqual(signalEdge, await edge(JSONModel), "edge cases as in JSONModel");

      const part = new SignalModel<Record<string, unknown>>({
        here: { x: undefined, k: 1 },
        there: { z: undefined },
      });
      part.mergeProperty("/here", { k: 2 });
      assert.deepEqual(
        [
          Object.keys(part.getProperty("/here") as object),
          "z" in (part.getProperty("/there") as object),
        ],
        [["k"], true],
        "mergeProperty drops them in the part it merges",
      );
      let partFired = 0;
      const rows = part.bindList("/");
      rows.attachChange(() => partFired++);
      rows.initialize();
      part.setProperty("/here/k", undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
      partFired = 0;
      part.mergeProperty("/here", {});
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(partFired, 1, "and a list above notices the dropped key");

      // undefined that came in with new data, or without the model and a refresh
      part.setData({}, true);
      part.setData({ fresh: undefined });
      part.setData({}, true);
      assert.deepEqual(Object.keys(part.getData()), [], "dropped from new data");
      part.getData().direct = undefined;
      part.refresh();
      part.setData({}, true);
      assert.deepEqual(Object.keys(part.getData()), [], "dropped after a refresh");
      part.destroy();
    });

    QUnit.test("a merge of data it cannot change in place, like JSONModel", async (assert) => {
      class Row {
        a = 1;
        gone = undefined;
      }
      const run = async (Model: typeof JSONModel | typeof SignalModel): Promise<string> => {
        const instance = new Model(new Row());
        instance.setData({ b: 2 } as object, true);
        // an object of another window is a plain object too
        const frame = document.body.appendChild(document.createElement("iframe"));
        const foreign = (frame.contentWindow as unknown as { JSON: JSON }).JSON.parse(
          '{"a":1}',
        ) as object;
        const other = new Model({ o: foreign });
        other.setData({ o: { b: 2 } } as object, true);
        const frozen = new Model(Object.freeze({ a: 1, o: Object.freeze({ x: 1 }) }));
        frozen.setData({ a: 2, o: { x: 2 } } as object, true);
        const nested = new Model({ a: 1, o: Object.freeze({ x: 1, gone: undefined }) });
        nested.setData({ b: 2 } as object, true);
        nested.setData({ o: { x: 2 } } as object, true);
        // a merge elsewhere leaves nothing frozen behind
        const thawed = new Model({ a: 1 });
        thawed.setProperty("/o", Object.freeze({ x: 1 }));
        thawed.setData({ a: 2 } as object, true);
        thawed.setProperty("/o/x", 2);
        // a list on the root, a key of the root dropped by a merge, then a change in a row
        const rooted = new Model({ rows: [{ n: 1 }], gone: undefined });
        let rootFired = 0;
        const rootList = rooted.bindList("/");
        rootList.attachChange(() => rootFired++);
        rootList.initialize();
        rootList.getContexts(0, 10);
        rooted.setData({} as object, true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        rootFired = 0;
        rooted.setProperty("/rows/0/n", 2);
        await new Promise((resolve) => setTimeout(resolve, 0));
        // not a plain object for UI5: replaced, not merged into
        const tagged = new Model({ o: { a: 1, [Symbol.toStringTag]: "T" } });
        tagged.setData({ o: { b: 2 } } as object, true);
        const text = new Model({ a: 1 });
        text.setData("xy" as unknown as object, true);

        // a suspended list: a change taken back by a second merge is none at resume()
        const model = new Model({ rows: [{ x: 1 }] });
        let fired = 0;
        const list = model.bindList("/rows");
        list.attachChange(() => fired++);
        list.initialize();
        const counts: number[] = [];
        for (const last of [1, 3]) {
          fired = 0;
          list.suspend();
          model.setData({ rows: [{ x: 2 }] }, true);
          model.setData({ rows: [{ x: last }] }, true);
          list.resume();
          await new Promise((resolve) => setTimeout(resolve, 0));
          counts.push(fired);
        }
        const state = JSON.stringify([
          instance.getData(),
          other.getData(),
          Object.getPrototypeOf(instance.getData()) === Object.prototype,
          frozen.getData(),
          nested.getData(),
          tagged.getData(),
          thawed.getData(),
          rootFired,
          text.getData(),
          counts,
          typeof (model as unknown as { checkUpdate(): unknown }).checkUpdate(),
        ]);
        for (const each of [instance, frozen, nested, tagged, thawed, rooted, text, model, other])
          each.destroy();
        frame.remove();
        return state;
      };
      const signal = await run(SignalModel);
      assert.strictEqual(
        signal,
        '[{"a":1,"b":2},{"o":{"a":1,"b":2}},true,{"a":2,"o":{"x":2}},{"a":1,"o":{"x":2},"b":2},{"o":{"b":2}},{"a":2,"o":{"x":2}},1,{"0":"x","1":"y","a":1},[0,1],"number"]',
        "class instance and frozen data are rebuilt, the list compares first and last state",
      );
      assert.strictEqual(signal, await run(JSONModel), "as in JSONModel");

      const partly = new SignalModel<Record<string, unknown>>({
        o: Object.freeze({ x: 1, deep: Object.freeze({ y: 1 }) }),
      });
      let seen: unknown;
      const y = partly.bindProperty("/o/deep/y");
      y.attachChange(() => (seen = y.getValue()));
      partly.mergeProperty("/o", { deep: { y: 2 } });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(
        [partly.getProperty("/o"), seen],
        [{ x: 1, deep: { y: 2 } }, 2],
        "mergeProperty into a frozen object writes a merged copy",
      );
      partly.destroy();

      // all of it frozen, and a list whose row is merged before the frozen object is met
      const deep = new SignalModel<Record<string, unknown>>(
        Object.freeze({ a: Object.freeze({ items: [{ n: 1 }], z: Object.freeze({ x: 1 }) }) }),
      );
      let rowsFired = 0;
      const items = deep.bindList("/a/items");
      items.attachChange(() => rowsFired++);
      items.initialize();
      items.getContexts(0, 10);
      await new Promise((resolve) => setTimeout(resolve, 0));
      rowsFired = 0;
      assert.ok(deep.mergeProperty("/a", { items: [{ n: 2 }], z: { x: 2 } }), "merged");
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(
        [deep.getData(), rowsFired],
        [{ a: { items: [{ n: 2 }], z: { x: 2 } } }, 1],
        "mergeProperty into data frozen at every level, and the list fires once",
      );
      deep.destroy();

      // mergeProperty below a row does not reach the list, suspended or not
      const part = new SignalModel({ rows: [{ deep: { v: 1 } }] });
      let fired = 0;
      const list = part.bindList("/rows");
      list.attachChange(() => fired++);
      list.initialize();
      // the first check of a list that was never read fires
      part.mergeProperty("/rows/0/deep", { v: 9 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      fired = 0;
      part.mergeProperty("/rows/0/deep", { v: 2 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const awake = fired;
      list.suspend();
      part.mergeProperty("/rows/0/deep", { v: 3 });
      list.resume();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(
        [awake, fired - awake],
        [0, 0],
        "mergeProperty in a row, awake and suspended",
      );
      part.destroy();
    });

    QUnit.test(
      "a suspended list after a merge that drops undefined, like JSONModel",
      async (assert) => {
        const run = async (Model: typeof JSONModel | typeof SignalModel): Promise<string> => {
          const counts: number[] = [];
          for (const rows of [
            [{ n: 1, gone: undefined }],
            [{ n: 1, tags: [1, undefined] }],
            [{ n: 1 }, undefined],
            [{ n: 1 }],
          ]) {
            const model = new Model({ rows });
            let fired = 0;
            const list = model.bindList("/rows");
            list.attachChange(() => fired++);
            list.initialize();
            list.getContexts();
            await new Promise((resolve) => setTimeout(resolve, 0));
            fired = 0;
            list.suspend();
            model.setData({ z: 1 } as object, true);
            list.resume();
            await new Promise((resolve) => setTimeout(resolve, 0));
            counts.push(fired);
            model.destroy();
          }
          return counts.join();
        };
        assert.strictEqual(await run(SignalModel), await run(JSONModel));
      },
    );

    QUnit.test("the recipes of docs/jsonmodel-differences.md", async (assert) => {
      const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
      const model = new SignalModel({
        address: { street: "Main St 1", city: "Berlin" },
        rows: [{ n: 1 }],
      });

      // A handler on an object that acts only on new content
      const binding = model.bindProperty("/address");
      let last = deepClone(binding.getValue());
      const seen = { events: 0, real: 0 };
      binding.attachChange(() => {
        seen.events++;
        const value = binding.getValue() as unknown;
        if (deepEqual(value, last)) return;
        last = deepClone(value);
        seen.real++;
      });
      model.setProperty("/address/city", "Paris");
      await tick();
      assert.strictEqual(JSON.stringify(seen), '{"events":1,"real":1}', "a write below the object");
      model.setProperty("/address", { street: "Main St 1", city: "Paris" });
      await tick();
      assert.strictEqual(JSON.stringify(seen), '{"events":2,"real":1}', "an equal object");

      // A list keyed by the row object after a merge that changed nothing
      const list = model.bindList("/rows");
      (
        list as unknown as { enableExtendedChangeDetection(detect: boolean, key: string): void }
      ).enableExtendedChangeDetection(false, "");
      let fired = 0;
      list.attachChange(() => fired++);
      list.initialize();
      list.getContexts(0, 10);
      await tick();
      fired = 0;
      model.setData({ rows: [{ n: 1 }] }, true);
      await tick();
      assert.strictEqual(fired, 0, "no event by itself");
      list.refresh(true);
      await tick();
      assert.strictEqual(fired, 1, "refresh(true) fires it");
      model.destroy();

      // Data changed without the model
      const shown = async (Model: typeof JSONModel | typeof SignalModel): Promise<string> => {
        const direct = new Model({ items: [1], busy: true });
        const items = direct.bindList("/items");
        items.attachChange(() => {});
        items.getContexts(0, 10);
        const rows: number[] = [];
        (direct.getData() as { items: number[] }).items.push(2);
        direct.setProperty("/busy", false);
        await tick();
        rows.push(items.getContexts(0, 10).length);
        direct.refresh();
        await tick();
        rows.push(items.getContexts(0, 10).length);
        direct.destroy();
        return rows.join();
      };
      assert.strictEqual(await shown(JSONModel), "2,2", "JSONModel: found by any write");
      assert.strictEqual(await shown(SignalModel), "1,2", "SignalModel: found by refresh()");
    });

    QUnit.test("a merge with keys named like parts of the prototype chain", (assert) => {
      const payload = (): object =>
        JSON.parse(
          '{"__proto__": {"x": 1}, "constructor": {"prototype": {"y": 2}}, "prototype": {"z": 3}, "a": 99}',
        ) as object;
      const results = [new JSONModel({ a: 1 }), new SignalModel({ a: 1 })].map((model) => {
        model.setData(payload(), true);
        // into the key the first merge created
        model.setData({ constructor: { again: 4 } } as never, true);
        // the payload's __proto__ must not become the prototype of the data either
        const data = JSON.stringify(model.getData()) + String(model.getProperty("/x"));
        model.destroy();
        return data;
      });
      assert.strictEqual(
        results[1],
        '{"a":99,"constructor":{"prototype":{"y":2},"again":4},"prototype":{"z":3}}undefined',
        "own keys, without __proto__",
      );
      assert.strictEqual(results[1], results[0], "same data as JSONModel");
      const probe = Object.prototype as Record<string, unknown>;
      assert.deepEqual(
        [probe.x, probe.y, (Object as unknown as Record<string, unknown>).again],
        [undefined, undefined, undefined],
        "nothing written to Object or its prototype",
      );

      const created = new SignalModel<Record<string, unknown>>({}, { autoCreatePaths: true });
      created.setProperty("/new/constructor/x", 1);
      assert.strictEqual(
        JSON.stringify(created.getData()),
        '{"new":{"constructor":{"x":1}}}',
        "autoCreatePaths creates an own key",
      );
      assert.strictEqual(
        (Object as unknown as Record<string, unknown>).x,
        undefined,
        "not on Object",
      );
      created.destroy();
    });

    QUnit.test("a write that leads into a prototype is refused", (assert) => {
      const model = new SignalModel<Record<string, unknown>>({ a: {}, constructor: { own: 1 } });
      const plain = new SignalModel<Record<string, unknown>>({ a: {} });
      const polluted = (): unknown => ({}) as Record<string, unknown>;
      try {
        for (const path of [
          "/__proto__/polluted",
          "/a/__proto__/polluted",
          "/a/constructor/prototype/polluted",
        ]) {
          assert.strictEqual(model.setProperty(path, 1), false, path);
        }
        assert.strictEqual(plain.setProperty("/constructor/prototype/polluted", 1), false);
        assert.strictEqual(plain.mergeProperty("/__proto__", { polluted: 1 }), false);
        assert.strictEqual(plain.mergeProperty("/constructor/prototype", { polluted: 1 }), false);
        assert.strictEqual((polluted() as { polluted?: number }).polluted, undefined);

        // Through a primitive, which has a prototype too
        const primitives = new SignalModel<Record<string, unknown>>({ n: 1, s: "hi", f: () => 1 });
        assert.strictEqual(primitives.setProperty("/n/constructor/prototype/polluted", 1), false);
        assert.strictEqual(primitives.setProperty("/f/constructor/prototype/polluted", 1), false);
        assert.strictEqual((Function.prototype as { polluted?: number }).polluted, undefined);
        assert.strictEqual(
          primitives.mergeProperty("/s/constructor/prototype", { polluted: 1 }),
          false,
        );
        assert.strictEqual((1 as unknown as { polluted?: number }).polluted, undefined);
        assert.strictEqual(("hi" as unknown as { polluted?: number }).polluted, undefined);
        primitives.destroy();

        // Behind objects that autoCreatePaths would create first
        const creating = new SignalModel<Record<string, unknown>>({}, { autoCreatePaths: true });
        assert.strictEqual(creating.setProperty("/a/b/__proto__", { polluted: 1 }), false);
        assert.strictEqual(creating.setProperty("/a/b/__proto__/polluted", 1), false);
        assert.deepEqual(creating.getData(), {}, "nothing was created");
        creating.destroy();
      } finally {
        delete (Object.prototype as { polluted?: number }).polluted;
        delete (Number.prototype as { polluted?: number }).polluted;
        delete (String.prototype as { polluted?: number }).polluted;
      }
      // A key of the data with that name is data
      assert.strictEqual(model.setProperty("/constructor/own", 2), true);
      assert.strictEqual(model.getProperty("/constructor/own"), 2);
      assert.strictEqual(plain.setProperty("/a/constructor", "x"), true, "as a new key");
      assert.deepEqual(plain.getData(), { a: { constructor: "x" } });
      model.destroy();
      plain.destroy();
    });

    QUnit.test("a computed at the root is refused", (assert) => {
      const model = new SignalModel({ val: 1 });
      assert.throws(() => model.createComputed("/", ["/val"], (v) => v), TypeError);
      assert.strictEqual(model.setProperty("/", { val: 2 }), true, "the root stays writable");
      model.destroy();
    });
  },
);
