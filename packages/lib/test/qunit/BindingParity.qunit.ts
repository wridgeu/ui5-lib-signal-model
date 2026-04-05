import SignalModel from "ui5/model/signal/SignalModel";
import JSONModel from "sap/ui/model/json/JSONModel";
import Input from "sap/m/Input";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import Sorter from "sap/ui/model/Sorter";

// JSONModel.isList exists at runtime but not in @openui5/types stubs
type JSONModelRuntime = JSONModel & { isList(sPath: string): boolean };

/**
 * Binding-level parity tests: run identical binding operations on both
 * JSONModel and SignalModel, then compare the results. Any difference
 * indicates a real parity gap.
 */
QUnit.module(
  "Binding Parity",
  {
    afterEach() {
      const fixture = document.getElementById("qunit-fixture");
      if (fixture) fixture.innerHTML = "";
    },
  },
  () => {
    // =========================================================================
    // 1. Property binding suspend/resume parity
    // =========================================================================

    QUnit.test("property binding suspend/resume parity", (assert) => {
      const done = assert.async();
      const data = { name: "Peter" };

      const json = new JSONModel(JSON.parse(JSON.stringify(data)));
      const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(data)));

      const jsonBinding = json.bindProperty("/name");
      const signalBinding = signal.bindProperty("/name");

      jsonBinding.suspend();
      signalBinding.suspend();

      json.setProperty("/name", "Petre");
      signal.setProperty("/name", "Petre");

      // While suspended, both bindings should still report the old value
      assert.strictEqual(
        signalBinding.getValue(),
        jsonBinding.getValue(),
        "suspended getValue matches -- both should be 'Peter'",
      );

      jsonBinding.resume();
      signalBinding.resume();

      setTimeout(() => {
        assert.strictEqual(
          signalBinding.getValue(),
          jsonBinding.getValue(),
          "resumed getValue matches -- both should be 'Petre'",
        );
        assert.strictEqual(signalBinding.getValue(), "Petre", "value is 'Petre' after resume");
        json.destroy();
        signal.destroy();
        done();
      }, 100);
    });

    // =========================================================================
    // 2. List binding sort on object-bound data parity
    // =========================================================================

    QUnit.test("list binding sort on object-bound data parity", (assert) => {
      const data = {
        items: {
          a: { name: "Zara" },
          b: { name: "Alice" },
          c: { name: "Mike" },
        },
      };

      const json = new JSONModel(JSON.parse(JSON.stringify(data)));
      const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(data)));

      const jsonBinding = json.bindList("/items");
      const signalBinding = signal.bindList("/items");

      jsonBinding.sort(new Sorter("name"));
      signalBinding.sort(new Sorter("name"));

      const jsonContexts = jsonBinding.getContexts(0, 10);
      const signalContexts = signalBinding.getContexts(0, 10);

      assert.strictEqual(
        signalContexts.length,
        jsonContexts.length,
        "sorted context count matches",
      );

      for (let i = 0; i < jsonContexts.length; i++) {
        assert.strictEqual(
          signal.getProperty("name", signalContexts[i]),
          json.getProperty("name", jsonContexts[i]),
          `sorted item ${i} name matches`,
        );
      }

      json.destroy();
      signal.destroy();
    });

    // =========================================================================
    // 3. List binding filter on object-bound data parity
    // =========================================================================

    QUnit.test("list binding filter on object-bound data parity", (assert) => {
      const data = {
        items: {
          a: { name: "Zara" },
          b: { name: "Alice" },
          c: { name: "Mike" },
        },
      };

      const json = new JSONModel(JSON.parse(JSON.stringify(data)));
      const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(data)));

      const jsonBinding = json.bindList("/items");
      const signalBinding = signal.bindList("/items");

      jsonBinding.filter([new Filter("name", FilterOperator.Contains, "li")]);
      signalBinding.filter([new Filter("name", FilterOperator.Contains, "li")]);

      const jsonContexts = jsonBinding.getContexts(0, 10);
      const signalContexts = signalBinding.getContexts(0, 10);

      assert.strictEqual(
        signalContexts.length,
        jsonContexts.length,
        "filtered context count matches",
      );

      for (let i = 0; i < jsonContexts.length; i++) {
        assert.strictEqual(
          signal.getProperty("name", signalContexts[i]),
          json.getProperty("name", jsonContexts[i]),
          `filtered item ${i} name matches`,
        );
      }

      json.destroy();
      signal.destroy();
    });

    // =========================================================================
    // 4. List binding suspend + sort parity (bIgnoreSuspend)
    // =========================================================================

    QUnit.test("list binding suspend + sort parity (bIgnoreSuspend)", (assert) => {
      const data = {
        items: [{ name: "Carol" }, { name: "Alice" }, { name: "Bob" }],
      };

      const json = new JSONModel(JSON.parse(JSON.stringify(data)));
      const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(data)));

      const jsonBinding = json.bindList("/items");
      const signalBinding = signal.bindList("/items");

      // Prime contexts before suspending
      jsonBinding.getContexts(0, 10);
      signalBinding.getContexts(0, 10);

      jsonBinding.suspend();
      signalBinding.suspend();

      // sort() sets bIgnoreSuspend=true internally, so it executes despite suspend
      jsonBinding.sort(new Sorter("name"));
      signalBinding.sort(new Sorter("name"));

      const jsonContexts = jsonBinding.getContexts(0, 10);
      const signalContexts = signalBinding.getContexts(0, 10);

      assert.strictEqual(
        signalContexts.length,
        jsonContexts.length,
        "sorted-while-suspended context count matches",
      );

      for (let i = 0; i < jsonContexts.length; i++) {
        assert.strictEqual(
          signal.getProperty("name", signalContexts[i]),
          json.getProperty("name", jsonContexts[i]),
          `suspended sort item ${i} name matches`,
        );
      }

      jsonBinding.resume();
      signalBinding.resume();
      json.destroy();
      signal.destroy();
    });

    // =========================================================================
    // 5. Property binding setValue parity
    // =========================================================================

    QUnit.test("property binding setValue parity", (assert) => {
      const done = assert.async();
      const data = { name: "Alice" };

      const json = new JSONModel(JSON.parse(JSON.stringify(data)));
      const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(data)));

      const jsonInput = new Input({ value: "{/name}" });
      const signalInput = new Input({ value: "{/name}" });

      jsonInput.setModel(json);
      signalInput.setModel(signal);

      jsonInput.placeAt("qunit-fixture");
      signalInput.placeAt("qunit-fixture");

      setTimeout(() => {
        const jsonBinding = jsonInput.getBinding("value")!;
        const signalBinding = signalInput.getBinding("value")!;

        (jsonBinding as unknown as { setValue(v: string): void }).setValue("newValue");
        (signalBinding as unknown as { setValue(v: string): void }).setValue("newValue");

        assert.strictEqual(
          signal.getProperty("/name"),
          json.getProperty("/name"),
          "model property matches after setValue -- both should be 'newValue'",
        );
        assert.strictEqual(signal.getProperty("/name"), "newValue", "value is 'newValue'");

        // Calling setValue with the same value again should not fire propertyChange on either
        let jsonPropertyChange = 0;
        let signalPropertyChange = 0;

        json.attachPropertyChange(() => jsonPropertyChange++);
        signal.attachPropertyChange(() => signalPropertyChange++);

        (jsonBinding as unknown as { setValue(v: string): void }).setValue("newValue");
        (signalBinding as unknown as { setValue(v: string): void }).setValue("newValue");

        setTimeout(() => {
          assert.strictEqual(
            signalPropertyChange,
            jsonPropertyChange,
            "propertyChange count matches for same-value setValue",
          );

          jsonInput.destroy();
          signalInput.destroy();
          json.destroy();
          signal.destroy();
          done();
        }, 100);
      }, 100);
    });

    // =========================================================================
    // 6. setJSON error parity
    // =========================================================================

    QUnit.test("setJSON with invalid JSON fires parseError on both models", (assert) => {
      const data = { name: "Alice" };

      const json = new JSONModel(JSON.parse(JSON.stringify(data)));
      const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(data)));

      let jsonErrorFired = false;
      let signalErrorFired = false;

      json.attachParseError(() => {
        jsonErrorFired = true;
      });
      signal.attachParseError(() => {
        signalErrorFired = true;
      });

      json.setJSON("invalid json");
      signal.setJSON("invalid json");

      assert.strictEqual(
        signalErrorFired,
        jsonErrorFired,
        "parseError fired state matches -- both should be true",
      );
      assert.ok(signalErrorFired, "SignalModel fired parseError");

      // Neither model should have changed data
      assert.deepEqual(
        signal.getData(),
        json.getData(),
        "data unchanged on both models after invalid JSON",
      );
      assert.strictEqual(signal.getProperty("/name"), "Alice", "SignalModel data preserved");
      assert.strictEqual(json.getProperty("/name"), "Alice", "JSONModel data preserved");

      json.destroy();
      signal.destroy();
    });

    // =========================================================================
    // 7. Tree binding filter + setData parity
    // =========================================================================

    QUnit.test("tree binding filter + setData parity", (assert) => {
      const done = assert.async();
      const data = {
        tree: [
          {
            name: "Alice",
            role: "CEO",
            children: [
              {
                name: "Bob",
                role: "CTO",
                children: [
                  { name: "Carol", role: "Dev", children: [] },
                  { name: "Dave", role: "QA", children: [] },
                ],
              },
              { name: "Eve", role: "CFO", children: [] },
            ],
          },
        ],
      };

      const json = new JSONModel(JSON.parse(JSON.stringify(data)));
      const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(data)));

      const jsonBinding = json.bindTree("/tree", undefined, [], { arrayNames: ["children"] }, []);
      const signalBinding = signal.bindTree(
        "/tree",
        undefined,
        [],
        { arrayNames: ["children"] },
        [],
      );

      // Apply identical filters
      jsonBinding.filter([new Filter("name", FilterOperator.Contains, "Carol")]);
      signalBinding.filter([new Filter("name", FilterOperator.Contains, "Carol")]);

      // Compare initial filtered tree
      const jsonRoots = jsonBinding.getRootContexts();
      const signalRoots = signalBinding.getRootContexts();

      assert.strictEqual(
        signalRoots.length,
        jsonRoots.length,
        "filtered root count matches after initial filter",
      );

      // Walk first level
      if (jsonRoots.length > 0 && signalRoots.length > 0) {
        assert.strictEqual(
          signal.getProperty("name", signalRoots[0]),
          json.getProperty("name", jsonRoots[0]),
          "root node name matches",
        );

        const jsonChildren = jsonBinding.getNodeContexts(jsonRoots[0]);
        const signalChildren = signalBinding.getNodeContexts(signalRoots[0]);
        assert.strictEqual(signalChildren.length, jsonChildren.length, "child count matches");
      }

      // Replace data and verify filter is re-applied
      const newData = {
        tree: [
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
      };

      let jsonChanged = false;
      let signalChanged = false;

      jsonBinding.attachChange(() => {
        jsonChanged = true;
      });
      signalBinding.attachChange(() => {
        signalChanged = true;
      });

      json.setData(JSON.parse(JSON.stringify(newData)));
      signal.setData(JSON.parse(JSON.stringify(newData)));

      setTimeout(() => {
        assert.ok(jsonChanged, "JSONModel tree binding fired change after setData");
        assert.ok(signalChanged, "SignalModel tree binding fired change after setData");

        const jsonNewRoots = jsonBinding.getRootContexts();
        const signalNewRoots = signalBinding.getRootContexts();

        assert.strictEqual(
          signalNewRoots.length,
          jsonNewRoots.length,
          "filtered root count matches after setData",
        );

        if (jsonNewRoots.length > 0 && signalNewRoots.length > 0) {
          assert.strictEqual(
            signal.getProperty("name", signalNewRoots[0]),
            json.getProperty("name", jsonNewRoots[0]),
            "new root node name matches",
          );

          const jsonNewChildren = jsonBinding.getNodeContexts(jsonNewRoots[0]);
          const signalNewChildren = signalBinding.getNodeContexts(signalNewRoots[0]);
          assert.strictEqual(
            signalNewChildren.length,
            jsonNewChildren.length,
            "new child count matches",
          );

          if (jsonNewChildren.length > 0 && signalNewChildren.length > 0) {
            const jsonLeaves = jsonBinding.getNodeContexts(jsonNewChildren[0]);
            const signalLeaves = signalBinding.getNodeContexts(signalNewChildren[0]);
            assert.strictEqual(signalLeaves.length, jsonLeaves.length, "new leaf count matches");
          }
        }

        json.destroy();
        signal.destroy();
        done();
      }, 100);
    });

    // =========================================================================
    // 8. isList parity for various paths
    // =========================================================================

    QUnit.test("isList parity for various path types", (assert) => {
      const data = {
        arrayPath: [1, 2, 3],
        objectPath: { a: 1, b: 2 },
        primitivePath: "hello",
      };

      const json = new JSONModel(JSON.parse(JSON.stringify(data))) as JSONModelRuntime;
      const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(data)));

      assert.strictEqual(
        signal.isList("/arrayPath"),
        json.isList("/arrayPath"),
        "/arrayPath: isList matches",
      );
      assert.strictEqual(
        signal.isList("/objectPath"),
        json.isList("/objectPath"),
        "/objectPath: isList matches",
      );
      assert.strictEqual(
        signal.isList("/primitivePath"),
        json.isList("/primitivePath"),
        "/primitivePath: isList matches",
      );
      assert.strictEqual(
        signal.isList("/nonexistent"),
        json.isList("/nonexistent"),
        "/nonexistent: isList matches",
      );

      // Verify actual values for clarity
      assert.ok(signal.isList("/arrayPath"), "array is a list");
      assert.notOk(signal.isList("/objectPath"), "object is not a list");
      assert.notOk(signal.isList("/primitivePath"), "primitive is not a list");
      assert.notOk(signal.isList("/nonexistent"), "nonexistent path is not a list");

      json.destroy();
      signal.destroy();
    });
  },
);
