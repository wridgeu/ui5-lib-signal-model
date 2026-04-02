import SignalModel from "ui5/model/signal/SignalModel";

QUnit.module("ExpressionBinding", () => {
  QUnit.test("composite binding with formatter", (assert) => {
    const model = new SignalModel({ firstName: "Alice", lastName: "Smith" });

    // Simulate composite binding by reading both values
    const first = model.getProperty("/firstName");
    const last = model.getProperty("/lastName");
    const formatted = `${first} ${last}`;

    assert.strictEqual(formatted, "Alice Smith", "can compose values from model");
    model.destroy();
  });

  QUnit.test("multiple bindings update independently", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ a: 1, b: 2 });
    const bindingA = model.bindProperty("/a");
    const bindingB = model.bindProperty("/b");
    let aChanged = false;
    let bChanged = false;

    bindingA.attachChange(() => {
      aChanged = true;
    });
    bindingB.attachChange(() => {
      bChanged = true;
    });

    model.setProperty("/a", 10);

    setTimeout(() => {
      assert.ok(aChanged, "binding A notified");
      assert.notOk(bChanged, "binding B not notified");
      assert.strictEqual(bindingA.getValue(), 10, "A has new value");
      assert.strictEqual(bindingB.getValue(), 2, "B unchanged");
      model.destroy();
      done();
    }, 100);
  });

  QUnit.test("computed signal as expression binding equivalent", (assert) => {
    const model = new SignalModel({ price: 100, quantity: 3, taxRate: 0.19 });

    model.createComputed(
      "/totalWithTax",
      ["/price", "/quantity", "/taxRate"],
      (price, quantity, taxRate) => {
        const subtotal = (price as number) * (quantity as number);
        return subtotal * (1 + (taxRate as number));
      },
    );

    const binding = model.bindProperty("/totalWithTax");
    assert.strictEqual(
      binding.getValue(),
      357,
      "computed expression correct: 100 * 3 * 1.19 = 357",
    );
    model.destroy();
  });

  QUnit.test("computed with string template expression", (assert) => {
    const model = new SignalModel({
      person: { title: "Dr.", firstName: "Alice", lastName: "Smith" },
    });

    model.createComputed(
      "/person/displayName",
      ["/person/title", "/person/firstName", "/person/lastName"],
      (title, first, last) => `${title} ${first} ${last}`,
    );

    const binding = model.bindProperty("/person/displayName");
    assert.strictEqual(binding.getValue(), "Dr. Alice Smith", "string template expression works");
    model.destroy();
  });

  QUnit.test("computed reacts to dependency changes", (assert) => {
    const done = assert.async();
    const model = new SignalModel({ items: [10, 20, 30] });

    model.createComputed("/sum", ["/items"], (items) => {
      return (items as number[]).reduce((a, b) => a + b, 0);
    });

    const binding = model.bindProperty("/sum");
    assert.strictEqual(binding.getValue(), 60, "initial sum correct");

    binding.attachChange(() => {
      assert.strictEqual(binding.getValue(), 100, "sum updated after items change");
      model.destroy();
      done();
    });

    model.setProperty("/items", [10, 20, 30, 40]);
  });

  QUnit.test("multiple computeds can chain", (assert) => {
    const model = new SignalModel({ width: 10, height: 5 });

    model.createComputed("/area", ["/width", "/height"], (w, h) => (w as number) * (h as number));
    model.createComputed(
      "/perimeter",
      ["/width", "/height"],
      (w, h) => 2 * ((w as number) + (h as number)),
    );

    assert.strictEqual(model.bindProperty("/area").getValue(), 50, "area = 10 * 5 = 50");
    assert.strictEqual(
      model.bindProperty("/perimeter").getValue(),
      30,
      "perimeter = 2*(10+5) = 30",
    );
    model.destroy();
  });
});
