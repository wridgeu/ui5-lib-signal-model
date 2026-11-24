import SignalModel from "ui5/model/signal/SignalModel";
import Text from "sap/m/Text";

QUnit.module("ExpressionBinding", () => {
  QUnit.test("expression binding evaluates and re-evaluates when a part changes", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ price: 100, quantity: 3 });
    const text = new Text({ text: "{= ${/price} * ${/quantity} }" });
    text.setModel(model);
    assert.strictEqual(text.getText(), "300", "initial expression value");

    model.setProperty("/quantity", 4);

    setTimeout(() => {
      assert.strictEqual(text.getText(), "400", "expression re-evaluated");
      text.destroy();
      model.destroy();
      done();
    }, 50);
  });

  QUnit.test("composite binding with formatter re-evaluates when a part changes", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ firstName: "Alice", lastName: "Smith" });
    const text = new Text({
      text: {
        parts: ["/firstName", "/lastName"],
        formatter: (first: string, last: string) => `${first} ${last}`,
      },
    });
    text.setModel(model);
    assert.strictEqual(text.getText(), "Alice Smith", "initial composite value");

    model.setProperty("/lastName", "Jones");

    setTimeout(() => {
      assert.strictEqual(text.getText(), "Alice Jones", "composite re-evaluated");
      text.destroy();
      model.destroy();
      done();
    }, 50);
  });
});
