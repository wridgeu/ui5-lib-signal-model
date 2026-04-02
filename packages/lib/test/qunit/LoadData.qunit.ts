import SignalModel from "ui5/model/signal/SignalModel";
import JSONModel from "sap/ui/model/json/JSONModel";

const BASE = "/test-resources/ui5/model/signal/qunit/testdata";
const SAMPLE_URL = `${BASE}/sample.json`;
const MERGE_URL = `${BASE}/merge.json`;
const BAD_URL = `${BASE}/does-not-exist.json`;

QUnit.module("loadData", () => {
  // =========================================================================
  // Constructor with URL
  // =========================================================================

  QUnit.test("constructor with URL loads data asynchronously", (assert) => {
    const done = assert.async();
    const model = new SignalModel(SAMPLE_URL);

    model.attachRequestCompleted(() => {
      assert.strictEqual(model.getProperty("/name"), "Alice", "name loaded");
      assert.strictEqual(model.getProperty("/age"), 28, "age loaded");
      assert.strictEqual(model.getProperty("/customer/firstName"), "Alice", "nested data loaded");
      model.destroy();
      done();
    });
  });

  // =========================================================================
  // loadData — basic
  // =========================================================================

  QUnit.test("loadData loads JSON and sets model data", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();

    model.loadData(SAMPLE_URL);

    model.attachRequestCompleted(() => {
      assert.strictEqual(model.getProperty("/name"), "Alice", "name loaded");
      assert.deepEqual(
        model.getProperty("/items/0"),
        { id: 1, label: "Alpha" },
        "array item loaded",
      );
      model.destroy();
      done();
    });
  });

  QUnit.test("loadData with merge preserves existing data", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>({ existing: true, age: 25 });

    model.loadData(MERGE_URL, undefined, undefined, undefined, true);

    model.attachRequestCompleted(() => {
      assert.strictEqual(model.getProperty("/existing"), true, "existing property preserved");
      assert.strictEqual(model.getProperty("/age"), 30, "age overwritten by merge");
      assert.strictEqual(
        model.getProperty("/customer/address/city"),
        "Munich",
        "deep merged value loaded",
      );
      model.destroy();
      done();
    });
  });

  // =========================================================================
  // dataLoaded() promise
  // =========================================================================

  QUnit.test("dataLoaded resolves after loadData completes", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();

    model.loadData(SAMPLE_URL);
    model.dataLoaded().then(() => {
      assert.strictEqual(model.getProperty("/name"), "Alice", "data available after dataLoaded");
      model.destroy();
      done();
    });
  });

  QUnit.test("dataLoaded resolves immediately when no load is pending", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ name: "Alice" });

    model.dataLoaded().then(() => {
      assert.ok(true, "dataLoaded resolves immediately");
      model.destroy();
      done();
    });
  });

  // =========================================================================
  // Events
  // =========================================================================

  QUnit.test("requestSent event fires before load", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();
    let sentFired = false;

    model.attachRequestSent(() => {
      sentFired = true;
    });

    model.attachRequestCompleted(() => {
      assert.ok(sentFired, "requestSent fired before requestCompleted");
      model.destroy();
      done();
    });

    model.loadData(SAMPLE_URL);
  });

  QUnit.test("requestFailed fires for bad URL", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>();

    model.attachRequestFailed(() => {
      assert.ok(true, "requestFailed fired for non-existent URL");
      model.destroy();
      done();
    });

    model.loadData(BAD_URL);
  });

  // =========================================================================
  // JSONModel parity
  // =========================================================================

  QUnit.test("loadData produces identical data to JSONModel", (assert) => {
    const done = assert.async();
    const json = new JSONModel();
    const signal = new SignalModel<Record<string, unknown>>();

    let jsonDone = false;
    let signalDone = false;

    function checkBoth(): void {
      if (jsonDone && signalDone) {
        assert.deepEqual(signal.getData(), json.getData(), "loaded data matches JSONModel");
        json.destroy();
        signal.destroy();
        done();
      }
    }

    json.attachRequestCompleted(() => {
      jsonDone = true;
      checkBoth();
    });
    signal.attachRequestCompleted(() => {
      signalDone = true;
      checkBoth();
    });

    json.loadData(SAMPLE_URL);
    signal.loadData(SAMPLE_URL);
  });

  QUnit.test("loadData with merge produces identical data to JSONModel", (assert) => {
    const done = assert.async();
    const initial = { existing: true, age: 25 };
    const json = new JSONModel(JSON.parse(JSON.stringify(initial)));
    const signal = new SignalModel<Record<string, unknown>>(JSON.parse(JSON.stringify(initial)));

    let jsonDone = false;
    let signalDone = false;

    function checkBoth(): void {
      if (jsonDone && signalDone) {
        assert.deepEqual(signal.getData(), json.getData(), "merged data matches JSONModel");
        assert.strictEqual(signal.getProperty("/existing"), true, "existing preserved");
        assert.strictEqual(signal.getProperty("/age"), 30, "age merged");
        json.destroy();
        signal.destroy();
        done();
      }
    }

    json.attachRequestCompleted(() => {
      jsonDone = true;
      checkBoth();
    });
    signal.attachRequestCompleted(() => {
      signalDone = true;
      checkBoth();
    });

    json.loadData(MERGE_URL, undefined, undefined, undefined, true);
    signal.loadData(MERGE_URL, undefined, undefined, undefined, true);
  });

  // =========================================================================
  // Configuration modes with loadData
  // =========================================================================

  QUnit.test("loadData + autoCreatePaths: setProperty creates paths after load", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>({}, { autoCreatePaths: true });

    model.loadData(SAMPLE_URL);
    model.dataLoaded().then(() => {
      // After load, autoCreatePaths should still work for new paths
      const result = model.setProperty("/newSection/deep/value", "created");
      assert.ok(result, "autoCreatePaths creates path after loadData");
      assert.strictEqual(model.getProperty("/newSection/deep/value"), "created", "value set");
      // Loaded data still intact
      assert.strictEqual(model.getProperty("/name"), "Alice", "loaded data intact");
      model.destroy();
      done();
    });
  });

  QUnit.test("loadData + strictLeafCheck: rejects new leaves after load", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>({}, { strictLeafCheck: true });

    model.loadData(SAMPLE_URL);
    model.dataLoaded().then(() => {
      // Existing leaf: allowed
      const r1 = model.setProperty("/name", "Bob");
      assert.ok(r1, "existing leaf accepted");
      assert.strictEqual(model.getProperty("/name"), "Bob", "value updated");

      // New leaf on existing parent: rejected
      const r2 = model.setProperty("/newProp", "nope");
      assert.notOk(r2, "new leaf rejected by strictLeafCheck");

      model.destroy();
      done();
    });
  });

  // =========================================================================
  // Binding updates after loadData
  // =========================================================================

  QUnit.test("bindings update after loadData", (assert) => {
    const done = assert.async();
    const model = new SignalModel<Record<string, unknown>>({ name: "placeholder" });
    const binding = model.bindProperty("/name");

    assert.strictEqual(binding.getValue(), "placeholder", "initial value");

    binding.attachChange(() => {
      assert.strictEqual(binding.getValue(), "Alice", "binding updated after loadData");
      model.destroy();
      done();
    });

    model.loadData(SAMPLE_URL);
  });
});
