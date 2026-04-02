import SignalModel from "ui5/model/signal/SignalModel";
import Text from "sap/m/Text";
import Input from "sap/m/Input";
import List from "sap/m/List";
import StandardListItem from "sap/m/StandardListItem";
import VBox from "sap/m/VBox";
import Label from "sap/m/Label";

QUnit.module("DeclarativeBinding", {
  afterEach() {
    const fixture = document.getElementById("qunit-fixture");
    if (fixture) fixture.innerHTML = "";
  },
});

QUnit.test("one-way binding: Text control reflects model data", (assert) => {
  const done = assert.async();
  const model = new SignalModel({ greeting: "Hello, World!" });

  const text = new Text({ text: "{/greeting}" });
  text.setModel(model);
  text.placeAt("qunit-fixture");

  sap.ui.require(["sap/ui/core/Core"], (Core: any) => {
    (Core.ready || Core.attachInit).call(Core, () => {
      setTimeout(() => {
        assert.strictEqual(text.getText(), "Hello, World!", "Text control shows model value");
        text.destroy();
        model.destroy();
        done();
      }, 100);
    });
  });
});

QUnit.test("one-way binding: model change updates Text control", (assert) => {
  const done = assert.async();
  const model = new SignalModel({ name: "Alice" });

  const text = new Text({ text: "{/name}" });
  text.setModel(model);
  text.placeAt("qunit-fixture");

  setTimeout(() => {
    assert.strictEqual(text.getText(), "Alice", "initial value shown");

    model.setProperty("/name", "Bob");

    setTimeout(() => {
      assert.strictEqual(text.getText(), "Bob", "Text updated after setProperty");
      text.destroy();
      model.destroy();
      done();
    }, 100);
  }, 100);
});

QUnit.test("two-way binding: Input control writes back to model", (assert) => {
  const done = assert.async();
  const model = new SignalModel({ username: "alice" });

  const input = new Input({ value: "{/username}" });
  input.setModel(model);
  input.placeAt("qunit-fixture");

  setTimeout(() => {
    assert.strictEqual(input.getValue(), "alice", "initial input value");

    // Simulate user typing by setting value and firing change
    input.setValue("bob");
    input.fireChange({ value: "bob" });

    setTimeout(() => {
      assert.strictEqual(
        model.getProperty("/username"),
        "bob",
        "model updated via two-way binding",
      );
      input.destroy();
      model.destroy();
      done();
    }, 100);
  }, 100);
});

QUnit.test("two-way binding: model change updates Input control", (assert) => {
  const done = assert.async();
  const model = new SignalModel({ email: "alice@example.com" });

  const input = new Input({ value: "{/email}" });
  input.setModel(model);
  input.placeAt("qunit-fixture");

  setTimeout(() => {
    assert.strictEqual(input.getValue(), "alice@example.com", "initial value");

    model.setProperty("/email", "bob@example.com");

    setTimeout(() => {
      assert.strictEqual(input.getValue(), "bob@example.com", "Input updated after setProperty");
      input.destroy();
      model.destroy();
      done();
    }, 100);
  }, 100);
});

QUnit.test("list binding: List control renders items from model array", (assert) => {
  const done = assert.async();
  const model = new SignalModel({
    fruits: [{ name: "Apple" }, { name: "Banana" }, { name: "Cherry" }],
  });

  const list = new List({
    items: {
      path: "/fruits",
      template: new StandardListItem({ title: "{name}" }),
    },
  });
  list.setModel(model);
  list.placeAt("qunit-fixture");

  setTimeout(() => {
    const items = list.getItems();
    assert.strictEqual(items.length, 3, "3 list items rendered");
    assert.strictEqual((items[0] as StandardListItem).getTitle(), "Apple", "first item title");
    assert.strictEqual((items[2] as StandardListItem).getTitle(), "Cherry", "third item title");
    list.destroy();
    model.destroy();
    done();
  }, 2000);
});

QUnit.test("list binding: model update re-renders list items", (assert) => {
  const done = assert.async();
  const model = new SignalModel({
    colors: [{ name: "Red" }, { name: "Blue" }],
  });

  const list = new List({
    items: {
      path: "/colors",
      template: new StandardListItem({ title: "{name}" }),
    },
  });
  list.setModel(model);
  list.placeAt("qunit-fixture");

  setTimeout(() => {
    assert.strictEqual(list.getItems().length, 2, "initial 2 items");

    model.setProperty("/colors", [{ name: "Red" }, { name: "Blue" }, { name: "Green" }]);

    setTimeout(() => {
      assert.strictEqual(list.getItems().length, 3, "3 items after update");
      assert.strictEqual(
        (list.getItems()[2] as StandardListItem).getTitle(),
        "Green",
        "new item rendered",
      );
      list.destroy();
      model.destroy();
      done();
    }, 2000);
  }, 2000);
});

QUnit.test("multiple controls share same model and stay in sync", (assert) => {
  const done = assert.async();
  const model = new SignalModel({ value: "initial" });

  const input = new Input({ value: "{/value}" });
  const text = new Text({ text: "{/value}" });
  const label = new Label({ text: "{/value}" });

  const container = new VBox({ items: [input, text, label] });
  container.setModel(model);
  container.placeAt("qunit-fixture");

  setTimeout(() => {
    assert.strictEqual(input.getValue(), "initial", "input shows initial");
    assert.strictEqual(text.getText(), "initial", "text shows initial");
    assert.strictEqual(label.getText(), "initial", "label shows initial");

    model.setProperty("/value", "updated");

    setTimeout(() => {
      assert.strictEqual(input.getValue(), "updated", "input updated");
      assert.strictEqual(text.getText(), "updated", "text updated");
      assert.strictEqual(label.getText(), "updated", "label updated");
      container.destroy();
      model.destroy();
      done();
    }, 100);
  }, 100);
});

QUnit.test("nested property binding through controls", (assert) => {
  const done = assert.async();
  const model = new SignalModel({
    customer: {
      name: "Alice",
      address: { city: "Berlin", zip: "10115" },
    },
  });

  const nameText = new Text({ text: "{/customer/name}" });
  const cityText = new Text({ text: "{/customer/address/city}" });
  const zipText = new Text({ text: "{/customer/address/zip}" });

  const container = new VBox({ items: [nameText, cityText, zipText] });
  container.setModel(model);
  container.placeAt("qunit-fixture");

  setTimeout(() => {
    assert.strictEqual(nameText.getText(), "Alice", "name bound");
    assert.strictEqual(cityText.getText(), "Berlin", "nested city bound");
    assert.strictEqual(zipText.getText(), "10115", "nested zip bound");

    model.setProperty("/customer/address/city", "Munich");

    setTimeout(() => {
      assert.strictEqual(cityText.getText(), "Munich", "city updated");
      assert.strictEqual(zipText.getText(), "10115", "zip unchanged");
      container.destroy();
      model.destroy();
      done();
    }, 100);
  }, 100);
});

QUnit.test("named model binding in controls", (assert) => {
  const done = assert.async();
  const model = new SignalModel({ title: "Signal Data" });

  const text = new Text({ text: "{myModel>/title}" });
  text.setModel(model, "myModel");
  text.placeAt("qunit-fixture");

  setTimeout(() => {
    assert.strictEqual(text.getText(), "Signal Data", "named model binding works");

    model.setProperty("/title", "Updated Signal Data");

    setTimeout(() => {
      assert.strictEqual(text.getText(), "Updated Signal Data", "named model updated");
      text.destroy();
      model.destroy();
      done();
    }, 100);
  }, 100);
});

QUnit.test("binding mode OneWay prevents write-back", (assert) => {
  const done = assert.async();
  sap.ui.require(["sap/ui/model/BindingMode"], (BindingMode: any) => {
    const model = new SignalModel({ locked: "original" });
    model.setDefaultBindingMode(BindingMode.OneWay);

    const input = new Input({ value: "{/locked}" });
    input.setModel(model);
    input.placeAt("qunit-fixture");

    setTimeout(() => {
      assert.strictEqual(input.getValue(), "original", "initial value shown");

      // Try to write back
      input.setValue("changed");
      input.fireChange({ value: "changed" });

      setTimeout(() => {
        assert.strictEqual(
          model.getProperty("/locked"),
          "original",
          "model NOT updated in OneWay mode",
        );
        input.destroy();
        model.destroy();
        done();
      }, 100);
    }, 100);
  });
});
