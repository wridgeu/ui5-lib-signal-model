import Controller from "sap/ui/core/mvc/Controller";
import type SignalModel from "ui5/model/signal/SignalModel";
import { getSampleData } from "../model/sampleData";

/**
 * @namespace demo.app.controller
 */
export default class PropertyBinding extends Controller {
  onReset(): void {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- always defined in controller lifecycle
    const model = this.getView()!.getModel() as SignalModel;
    const data = getSampleData();
    model.setProperty("/firstName", data.firstName);
    model.setProperty("/lastName", data.lastName);
    model.setProperty("/age", data.age);
    model.setProperty("/email", data.email);
  }
}
