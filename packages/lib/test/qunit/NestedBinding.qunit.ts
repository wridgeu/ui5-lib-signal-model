import SignalModel from "ui5/model/signal/SignalModel";

QUnit.module("NestedBinding", () => {
  QUnit.test("relative property binding with list context", (assert) => {
    const model = new SignalModel({
      items: [
        { name: "Alice", age: 28 },
        { name: "Bob", age: 35 },
      ],
    });
    const listBinding = model.bindList("/items");
    const contexts = listBinding.getContexts(0, 10);

    // Bind relative property within list context
    assert.strictEqual(
      model.getProperty("name", contexts[0]),
      "Alice",
      "relative read from first context",
    );
    assert.strictEqual(
      model.getProperty("age", contexts[1]),
      35,
      "relative read from second context",
    );
    model.destroy();
  });

  QUnit.test("nested list binding (list within list)", (assert) => {
    const model = new SignalModel({
      departments: [
        {
          name: "Engineering",
          employees: [
            { name: "Alice", role: "Developer" },
            { name: "Bob", role: "Designer" },
          ],
        },
        {
          name: "Marketing",
          employees: [{ name: "Carol", role: "Manager" }],
        },
      ],
    });
    const deptBinding = model.bindList("/departments");
    const deptContexts = deptBinding.getContexts(0, 10);

    // Bind inner list relative to department context
    const empBinding = model.bindList("employees", deptContexts[0]);
    const empContexts = empBinding.getContexts(0, 10);

    assert.strictEqual(empContexts.length, 2, "2 employees in Engineering");
    assert.strictEqual(model.getProperty("name", empContexts[0]), "Alice", "first employee");
    assert.strictEqual(
      model.getProperty("role", empContexts[1]),
      "Designer",
      "second employee role",
    );

    // Check second department
    const empBinding2 = model.bindList("employees", deptContexts[1]);
    const empContexts2 = empBinding2.getContexts(0, 10);

    assert.strictEqual(empContexts2.length, 1, "1 employee in Marketing");
    assert.strictEqual(model.getProperty("name", empContexts2[0]), "Carol", "marketing employee");
    model.destroy();
  });

  QUnit.test("deeply nested property access through contexts", (assert) => {
    const model = new SignalModel({
      company: {
        departments: [
          {
            name: "IT",
            teams: [
              {
                name: "Frontend",
                members: [{ name: "Alice", skills: ["TypeScript", "UI5"] }],
              },
            ],
          },
        ],
      },
    });

    assert.strictEqual(
      model.getProperty("/company/departments/0/teams/0/members/0/name"),
      "Alice",
      "deep absolute path works",
    );
    assert.deepEqual(
      model.getProperty("/company/departments/0/teams/0/members/0/skills"),
      ["TypeScript", "UI5"],
      "deep array property works",
    );
    model.destroy();
  });

  QUnit.test("setProperty on nested path notifies binding", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      departments: [
        {
          name: "Engineering",
          employees: [{ name: "Alice" }, { name: "Bob" }],
        },
      ],
    });
    const binding = model.bindProperty("/departments/0/employees/0/name");

    binding.attachChange(() => {
      assert.strictEqual(binding.getValue(), "Carol", "nested binding updated");
      model.destroy();
      done();
    });

    model.setProperty("/departments/0/employees/0/name", "Carol");
  });

  QUnit.test("modifying parent list notifies child bindings", (assert) => {
    const done = assert.async();
    const model = new SignalModel({
      items: [
        { name: "A", sub: [1, 2, 3] },
        { name: "B", sub: [4, 5] },
      ],
    });
    const listBinding = model.bindList("/items");
    listBinding.getContexts(0, 10);
    let changed = false;

    listBinding.attachChange(() => {
      changed = true;
    });

    model.setProperty("/items", [
      { name: "A", sub: [1, 2, 3] },
      { name: "B", sub: [4, 5] },
      { name: "C", sub: [6] },
    ]);

    setTimeout(() => {
      assert.ok(changed, "list binding notified when parent array changes");
      const contexts = listBinding.getContexts(0, 10);
      assert.strictEqual(contexts.length, 3, "3 items after update");
      model.destroy();
      done();
    }, 100);
  });
});
