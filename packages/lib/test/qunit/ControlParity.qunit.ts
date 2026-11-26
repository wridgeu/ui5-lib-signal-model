import SignalModel from "ui5/model/signal/SignalModel";
import JSONModel from "sap/ui/model/json/JSONModel";
import type Input from "sap/m/Input";
import Text from "sap/m/Text";
import type List from "sap/m/List";
import XMLView from "sap/ui/core/mvc/XMLView";
import Column from "sap/ui/table/Column";
import TreeTable from "sap/ui/table/TreeTable";
import nextUIUpdate from "sap/ui/test/utils/nextUIUpdate";
import type DataState from "sap/ui/model/DataState";

type Model = JSONModel | SignalModel<Record<string, unknown>>;

/** Runs `scenario` with each model and returns what it recorded: [JSONModel, SignalModel]. */
async function withBoth(
  data: () => Record<string, unknown>,
  scenario: (model: Model, record: (label: string, state: unknown) => void) => Promise<void>,
): Promise<string[][]> {
  const logs: string[][] = [];
  for (const model of [new JSONModel(data()), new SignalModel<Record<string, unknown>>(data())]) {
    const log: string[] = [];
    await scenario(model, (label, state) => log.push(`${label}: ${JSON.stringify(state)}`));
    model.destroy();
    logs.push(log);
  }
  return logs;
}

/** The table updates its rows in timers of its own. */
async function settled(): Promise<void> {
  await nextUIUpdate();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await nextUIUpdate();
}

/**
 * Controls the parity fuzz does not use, with the same steps on both models: what they
 * show after each step has to be the same.
 */
QUnit.module("Control Parity", () => {
  QUnit.test("sap.ui.table.TreeTable", async (assert) => {
    const [json, signal] = await withBoth(
      () => ({
        nodes: [
          { name: "a", nodes: [{ name: "a1" }, { name: "a2" }] },
          { name: "b", nodes: [{ name: "b1" }] },
        ],
      }),
      async (model, record) => {
        const table = new TreeTable({
          rows: { path: "/", parameters: { arrayNames: ["nodes"] } },
          columns: [new Column({ template: new Text({ text: "{name}" }) })],
        });
        table.setRowMode("Fixed");
        table.setModel(model);
        table.placeAt("qunit-fixture");
        const rows = (): unknown[] => [
          (table.getBinding("rows") as unknown as { getLength(): number }).getLength(),
          ...table
            .getRows()
            .filter((row) => row.getBindingContext())
            .map(
              (row) =>
                `${row.getBindingContext()!.getPath()}=${(row.getCells()[0] as Text).getText()}`,
            ),
        ];
        const step = async (label: string, action: () => void): Promise<void> => {
          action();
          await settled();
          record(label, rows());
        };

        await step("initial", () => {});
        await step("expand", () => table.expand(0));
        await step("write to a visible child", () =>
          model.setProperty("/nodes/0/nodes/1/name", "A2"),
        );
        await step("merge that adds a child", () =>
          model.setData({ nodes: [{ nodes: [{}, {}, { name: "a3" }] }] }, true),
        );
        await step("replace the children", () =>
          model.setProperty("/nodes/0/nodes", [{ name: "z" }]),
        );
        await step("expand the second node", () => table.expand(2));
        await step("change without the model, then refresh", () => {
          (model.getData() as { nodes: { name: string }[] }).nodes[1].name = "B";
          model.refresh();
        });
        await step("collapse", () => table.collapse(0));
        await step("replace all", () => model.setData({ nodes: [{ name: "only", nodes: [] }] }));
        table.destroy();
      },
    );
    assert.ok(json.length === 9 && json[1] !== json[0], "the steps change what the table shows");
    assert.deepEqual(signal, json, "same rows after every step");
  });

  QUnit.test("two views on one model, and the data state of an input", async (assert) => {
    const first = `<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc">
      <Input id="name" value="{/name}"/>
      <Input id="count" value="{path: '/count', type: 'sap.ui.model.type.Integer'}"/>
      <List id="items" items="{/items}"><StandardListItem title="{label}"/></List>
    </mvc:View>`;
    const second = `<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc">
      <Text id="name" text="{/name}"/>
      <Text id="sum" text="{= \${/count} + \${/items}.length }"/>
      <Text id="row" text="{label}"/>
    </mvc:View>`;
    const [json, signal] = await withBoth(
      () => ({ name: "n", count: 1, items: [{ label: "x" }, { label: "y" }] }),
      async (model, record) => {
        const views = [
          await XMLView.create({ definition: first }),
          await XMLView.create({ definition: second }),
        ];
        views.forEach((view) => view.setModel(model).placeAt("qunit-fixture"));
        views[1].byId("row")!.bindElement("/items/1");
        const count = views[0].byId("count") as Input;
        const state = (): unknown => {
          const dataState = (
            count.getBinding("value") as unknown as { getDataState(): DataState }
          ).getDataState();
          return {
            name: [
              (views[0].byId("name") as Input).getValue(),
              (views[1].byId("name") as Text).getText(),
            ],
            sum: (views[1].byId("sum") as Text).getText(),
            row: (views[1].byId("row") as Text).getText(),
            items: (views[0].byId("items") as List)
              .getItems()
              .map((item) => item.getBindingContext()!.getProperty("label") as unknown),
            count: [count.getValue(), model.getProperty("/count") as unknown],
            dataState: [
              dataState.getValue(),
              dataState.getOriginalValue(),
              dataState.getInvalidValue(),
              dataState.isDirty(),
              dataState.isControlDirty(),
              dataState.isLaundering(),
            ],
          };
        };
        const step = async (label: string, action: () => void): Promise<void> => {
          action();
          await settled();
          record(label, state());
        };

        await step("initial", () => {});
        await step("type into the first view", () =>
          (views[0].byId("name") as Input).setValue("typed"),
        );
        await step("type a number", () => count.setValue("5"));
        await step("type something that is no number", () => {
          count.setValue("abc");
        });
        await step("write the count through the model", () => model.setProperty("/count", 7));
        await step("add a row by merge", () =>
          model.setData({ items: [{}, {}, { label: "z" }] }, true),
        );
        await step("write to the row the second view shows", () =>
          model.setProperty("/items/1/label", "Y"),
        );
        await step("replace all", () => model.setData({ name: "new", count: 2, items: [] }));
        views.forEach((view) => view.destroy());
      },
    );
    assert.ok(json.length === 8 && json[1] !== json[0], "the steps change what the views show");
    assert.deepEqual(signal, json, "same state after every step");
  });

  QUnit.test(
    "the recipe for a formatter that can throw: catch in the formatter",
    async (assert) => {
      const format = (value: unknown): string => (value as number).toFixed(2);
      const safe = (value: unknown): string => {
        try {
          return format(value);
        } catch {
          return "n/a";
        }
      };
      const [json, signal] = await withBoth(
        () => ({ price: 1, other: "a" }),
        async (model, record) => {
          const price = new Text({ text: { path: "/price", formatter: safe } });
          const other = new Text({ text: "{/other}" });
          price.setModel(model);
          other.setModel(model);
          model.setProperty("/price", "no number");
          model.setProperty("/other", "b");
          await settled();
          record("after a value the formatter cannot handle", [price.getText(), other.getText()]);
          price.destroy();
          other.destroy();
        },
      );
      assert.deepEqual(signal, ['after a value the formatter cannot handle: ["n/a","b"]']);
      assert.deepEqual(signal, json, "the same in both models");

      // Without the recipe, the difference: no error out of setProperty, the other binding updates
      const model = new SignalModel({ price: 1, other: "a" });
      const price = new Text({ text: { path: "/price", formatter: format } });
      const other = new Text({ text: "{/other}" });
      price.setModel(model);
      other.setModel(model);
      model.setProperty("/price", "no number");
      model.setProperty("/other", "b");
      await settled();
      assert.strictEqual(other.getText(), "b", "an unsafe formatter does not stop other bindings");
      for (const each of [price, other, model]) each.destroy();
    },
  );
});
