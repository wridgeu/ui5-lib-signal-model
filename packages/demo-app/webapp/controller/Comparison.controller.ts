import JSONModel from "sap/ui/model/json/JSONModel";
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
    signal: { events: 0, real: 0, keys: "" },
    json: { events: 0, real: 0, keys: "" },
  });
  private city = 0;

  override onInit(): void {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- always defined in controller lifecycle
    const view = this.getView()!;
    view.setModel(this.state, "diff");
    this.models = {
      signal: new SignalModel({ address: { street: "Main St 1", city: CITIES[0] } }),
      json: new JSONModel({ address: { street: "Main St 1", city: CITIES[0] } }),
    };
    for (const [name, model] of Object.entries(this.models)) {
      view.setModel(model, `${name}Diff`);
      const count = (what: string): void => {
        const path = `/${name}/${what}`;
        this.state.setProperty(path, (this.state.getProperty(path) as number) + 1);
      };
      // The recipe from the README: a handler on an object that acts only on new content
      const binding = model.bindProperty("/address");
      let last = deepClone(binding.getValue());
      binding.attachChange(() => {
        count("events");
        const value = binding.getValue() as Address;
        if (deepEqual(value, last)) return;
        last = deepClone(value);
        count("real");
      });
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
    for (const model of Object.values(this.models)) model.destroy();
    this.state.destroy();
  }
}
