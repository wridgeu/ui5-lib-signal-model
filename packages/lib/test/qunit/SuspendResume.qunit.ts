import SignalModel from "ui5/model/signal/SignalModel";
import Input from "sap/m/Input";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import Sorter from "sap/ui/model/Sorter";

QUnit.module(
  "Suspend / Resume",
  {
    afterEach() {
      const fixture = document.getElementById("qunit-fixture");
      if (fixture) fixture.innerHTML = "";
    },
  },
  () => {
    // =========================================================================
    // PropertyBinding suspend/resume
    // =========================================================================

    QUnit.test("setValue on suspended property binding is silently ignored", (assert) => {
      const done = assert.async();
      const model = new SignalModel({ name: "Alice" });
      const binding = model.bindProperty("/name");

      binding.suspend();
      binding.setValue("Bob");

      setTimeout(() => {
        assert.strictEqual(
          model.getProperty("/name"),
          "Alice",
          "model value unchanged -- setValue was ignored while suspended",
        );
        assert.strictEqual(binding.getValue(), "Alice", "binding value unchanged");
        model.destroy();
        done();
      }, 50);
    });

    QUnit.test(
      "suspend + model change -- binding stays stale, resume picks up model value",
      (assert) => {
        const done = assert.async();
        const model = new SignalModel({ name: "Alice" });
        const binding = model.bindProperty("/name");
        let changeCount = 0;

        binding.attachChange(() => changeCount++);
        binding.suspend();

        model.setProperty("/name", "Bob");

        setTimeout(() => {
          assert.strictEqual(changeCount, 0, "no change event while suspended");
          assert.strictEqual(
            binding.getValue(),
            "Alice",
            "binding still shows stale value while suspended",
          );

          binding.resume();

          setTimeout(() => {
            assert.ok(changeCount > 0, "change event fired after resume");
            assert.strictEqual(
              binding.getValue(),
              "Bob",
              "binding picks up model value after resume",
            );
            model.destroy();
            done();
          }, 50);
        }, 50);
      },
    );

    QUnit.test("suspend + control value change -- resume restores model value", (assert) => {
      const done = assert.async();
      const model = new SignalModel({ username: "Alice" });

      const input = new Input({ value: "{/username}" });
      input.setModel(model);
      input.placeAt("qunit-fixture");

      setTimeout(() => {
        assert.strictEqual(input.getValue(), "Alice", "initial value shown");

        const binding = input.getBinding("value")!;
        binding.suspend();

        // Simulate the control changing its own value (user typing)
        input.setValue("ControlValue");

        setTimeout(() => {
          assert.strictEqual(
            model.getProperty("/username"),
            "Alice",
            "model NOT updated while binding is suspended",
          );

          binding.resume();

          setTimeout(() => {
            assert.strictEqual(
              input.getValue(),
              "Alice",
              "resume restores model value -- control reverts to model truth",
            );
            input.destroy();
            model.destroy();
            done();
          }, 50);
        }, 50);
      }, 50);
    });

    QUnit.test(
      "suspend + both model AND control change -- model value wins on resume",
      (assert) => {
        const done = assert.async();
        const model = new SignalModel({ username: "Alice" });

        const input = new Input({ value: "{/username}" });
        input.setModel(model);
        input.placeAt("qunit-fixture");

        setTimeout(() => {
          assert.strictEqual(input.getValue(), "Alice", "initial value");

          const binding = input.getBinding("value")!;
          binding.suspend();

          // Both sides change
          input.setValue("ControlValue");
          model.setProperty("/username", "ModelValue");

          setTimeout(() => {
            binding.resume();

            setTimeout(() => {
              assert.strictEqual(
                input.getValue(),
                "ModelValue",
                "model value wins on resume when both sides changed",
              );
              assert.strictEqual(
                model.getProperty("/username"),
                "ModelValue",
                "model retains its value",
              );
              input.destroy();
              model.destroy();
              done();
            }, 50);
          }, 50);
        }, 50);
      },
    );

    // =========================================================================
    // ListBinding suspend/resume
    // =========================================================================

    QUnit.test("list binding: data added during suspend not visible until resume", (assert) => {
      const done = assert.async();
      const model = new SignalModel({
        items: [{ name: "A" }],
      });
      const binding = model.bindList("/items");
      binding.getContexts(0, 10);
      let changeCount = 0;

      binding.attachChange(() => changeCount++);
      binding.suspend();

      model.setProperty("/items", [{ name: "A" }, { name: "B" }, { name: "C" }]);

      setTimeout(() => {
        assert.strictEqual(changeCount, 0, "no change event while suspended");
        // Contexts are stale while suspended
        const staleContexts = binding.getContexts(0, 10);
        assert.strictEqual(staleContexts.length, 1, "still shows 1 item while suspended");

        binding.resume();

        setTimeout(() => {
          assert.ok(changeCount > 0, "change event fired after resume");
          const contexts = binding.getContexts(0, 10);
          assert.strictEqual(contexts.length, 3, "all 3 items visible after resume");
          model.destroy();
          done();
        }, 50);
      }, 50);
    });

    QUnit.test(
      "list binding: sort executes immediately while suspended (bIgnoreSuspend)",
      (assert) => {
        const model = new SignalModel({
          items: [{ name: "Carol" }, { name: "Alice" }, { name: "Bob" }],
        });
        const binding = model.bindList("/items");
        binding.getContexts(0, 10);

        binding.suspend();

        // sort() sets bIgnoreSuspend=true internally, so checkUpdate runs despite suspend
        binding.sort(new Sorter("name"));
        const contexts = binding.getContexts(0, 10);

        assert.strictEqual(
          model.getProperty("name", contexts[0]),
          "Alice",
          "sorted first even while suspended",
        );
        assert.strictEqual(model.getProperty("name", contexts[1]), "Bob", "sorted second");
        assert.strictEqual(model.getProperty("name", contexts[2]), "Carol", "sorted third");

        binding.resume();
        model.destroy();
      },
    );

    QUnit.test(
      "list binding: filter executes immediately while suspended (bIgnoreSuspend)",
      (assert) => {
        const model = new SignalModel({
          items: [
            { name: "Alice", active: true },
            { name: "Bob", active: false },
            { name: "Carol", active: true },
          ],
        });
        const binding = model.bindList("/items");
        binding.getContexts(0, 10);

        binding.suspend();

        // filter() sets bIgnoreSuspend=true internally, so checkUpdate runs despite suspend
        binding.filter([new Filter("active", FilterOperator.EQ, true)]);
        const contexts = binding.getContexts(0, 10);

        assert.strictEqual(contexts.length, 2, "filtered to 2 active items while suspended");
        assert.strictEqual(model.getProperty("name", contexts[0]), "Alice", "first active item");
        assert.strictEqual(model.getProperty("name", contexts[1]), "Carol", "second active item");

        binding.resume();
        model.destroy();
      },
    );

    QUnit.test("list binding: checkUpdate(true) bypasses suspend (force refresh)", (assert) => {
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

        // Force refresh bypasses suspend
        binding.checkUpdate(true);

        setTimeout(() => {
          assert.ok(changeCount > 0, "change fired from forced checkUpdate");
          const contexts = binding.getContexts(0, 10);
          assert.strictEqual(contexts.length, 2, "2 items visible after forced refresh");
          binding.resume();
          model.destroy();
          done();
        }, 50);
      }, 50);
    });

    // =========================================================================
    // PropertyBinding setValue guards
    // =========================================================================

    QUnit.test("setValue with same value (deepEqual) -- no setProperty call", (assert) => {
      const done = assert.async();
      const model = new SignalModel({ value: "hello" });
      const binding = model.bindProperty("/value");
      let changeCount = 0;

      binding.attachChange(() => changeCount++);

      // setValue with the same primitive value -- deepEqual returns true, so no write
      binding.setValue("hello");

      setTimeout(() => {
        assert.strictEqual(changeCount, 0, "no change event for identical value");
        assert.strictEqual(model.getProperty("/value"), "hello", "model value unchanged");
        model.destroy();
        done();
      }, 50);
    });

    QUnit.test("setValue with deepEqual object -- no setProperty call", (assert) => {
      const done = assert.async();
      const obj = { a: 1, b: 2 };
      const model = new SignalModel({ value: obj });
      const binding = model.bindProperty("/value");
      let changeCount = 0;

      binding.attachChange(() => changeCount++);

      // setValue with a structurally equal object
      binding.setValue({ a: 1, b: 2 });

      setTimeout(() => {
        assert.strictEqual(changeCount, 0, "no change event for deepEqual object");
        model.destroy();
        done();
      }, 50);
    });

    QUnit.test(
      "propertyChange event fires from binding setValue, not from model.setProperty",
      (assert) => {
        const done = assert.async();
        const model = new SignalModel({ name: "Alice" });
        const binding = model.bindProperty("/name");
        let propertyChangeCount = 0;

        model.attachPropertyChange(() => {
          propertyChangeCount++;
        });

        // model.setProperty does NOT fire propertyChange
        model.setProperty("/name", "Bob");

        setTimeout(() => {
          assert.strictEqual(propertyChangeCount, 0, "no propertyChange from model.setProperty");

          // binding.setValue DOES fire propertyChange
          binding.setValue("Carol");

          setTimeout(() => {
            assert.strictEqual(
              propertyChangeCount,
              1,
              "propertyChange fires from binding.setValue",
            );
            model.destroy();
            done();
          }, 50);
        }, 50);
      },
    );
  },
);
