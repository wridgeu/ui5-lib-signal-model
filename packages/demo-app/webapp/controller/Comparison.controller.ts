import JSONModel from "sap/ui/model/json/JSONModel";
import type Binding from "sap/ui/model/Binding";
import type ListBinding from "sap/ui/model/ListBinding";
import deepClone from "sap/base/util/deepClone";
import deepEqual from "sap/base/util/deepEqual";
import SignalModel from "ui5/model/signal/SignalModel";
import BaseController from "./BaseController";

interface Address {
  street: string;
  city: string;
}

const CITIES = ["Berlin", "Paris", "Rome"];

/**
 * @namespace demo.app.controller
 */
export default class Comparison extends BaseController {
  /** One model of each kind with the same data, for the differences shown on the page */
  private models: Record<string, SignalModel | JSONModel> = {};
  private state = new JSONModel({
    signal: { events: 0, real: 0, keys: "", listEvents: 0 },
    json: { events: 0, real: 0, keys: "", listEvents: 0 },
  });
  private city = 0;
  private lists: ListBinding[] = [];
  private bindings: Binding[] = [];

  override onInit(): void {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- always defined in controller lifecycle
    const view = this.getView()!;
    view.setModel(this.state, "diff");
    const data = (): Record<string, unknown> => ({
      address: { street: "Main St 1", city: CITIES[0] },
      price: 9.99,
      rows: [{ n: 1 }, { n: 2 }],
    });
    this.models = { signal: new SignalModel(data()), json: new JSONModel(data()) };
    for (const [name, model] of Object.entries(this.models)) {
      view.setModel(model, `${name}Diff`);
      const count = (what: string): void => {
        const path = `/${name}/${what}`;
        this.state.setProperty(path, (this.state.getProperty(path) as number) + 1);
      };
      // The recipe from docs/jsonmodel-differences.md: a handler on an object that acts only on new content
      const binding = model.bindProperty("/address");
      let last = deepClone(binding.getValue());
      binding.attachChange(() => {
        count("events");
        const value = binding.getValue() as Address;
        if (deepEqual(value, last)) return;
        last = deepClone(value);
        count("real");
      });
      // A list whose change detection uses the row object itself as key
      const list = model.bindList("/rows");
      (
        list as unknown as { enableExtendedChangeDetection(detect: boolean, key: string): void }
      ).enableExtendedChangeDetection(false, "");
      list.initialize();
      list.getContexts(0, 10);
      list.attachChange(() => {
        count("listEvents");
        list.getContexts(0, 10);
      });
      this.lists.push(list);
      this.bindings.push(binding, list);
    }
  }

  formatAddress(address?: Address): string {
    return address ? `${address.street}, ${address.city}` : "";
  }

  /** A write below the bound object */
  onWriteCity(): void {
    this.city = (this.city + 1) % CITIES.length;
    for (const model of Object.values(this.models)) {
      model.setProperty("/address/city", CITIES[this.city]);
    }
  }

  /** A write of another object with the same content */
  onWriteEqualAddress(): void {
    for (const model of Object.values(this.models)) {
      model.setProperty("/address", { ...(model.getProperty("/address") as Address) });
    }
  }

  /** The recipe from docs/jsonmodel-differences.md: an error is caught where it belongs to one binding */
  formatPrice(price: unknown): string {
    try {
      return (price as number).toFixed(2);
    } catch {
      return "n/a";
    }
  }

  onWritePrice(): void {
    for (const model of Object.values(this.models)) {
      model.setProperty("/price", typeof model.getProperty("/price") === "number" ? "abc" : 9.99);
    }
  }

  /** A merge of the rows the list already has */
  onMergeSameRows(): void {
    for (const model of Object.values(this.models)) {
      model.setData({ rows: [{ n: 1 }, { n: 2 }] }, true);
    }
  }

  /** The recipe from docs/jsonmodel-differences.md: force the change event */
  onRefreshLists(): void {
    for (const list of this.lists) list.refresh(true);
  }

  onMergeWithoutRefresh(): void {
    this.directChangeThenMerge(false);
  }

  onMergeWithRefresh(): void {
    this.directChangeThenMerge(true);
  }

  /** A key that holds undefined, assigned to the data directly, and then a merge */
  private directChangeThenMerge(refresh: boolean): void {
    for (const [name, model] of Object.entries(this.models)) {
      model.setData({ saved: false }, true);
      (model.getData() as Record<string, unknown>).draft = undefined;
      if (refresh) model.refresh();
      model.setData({ saved: true }, true);
      this.state.setProperty(`/${name}/keys`, Object.keys(model.getData() as object).join(", "));
    }
  }

  override onExit(): void {
    for (const binding of this.bindings) binding.destroy();
    for (const model of Object.values(this.models)) model.destroy();
    this.state.destroy();
  }
}
