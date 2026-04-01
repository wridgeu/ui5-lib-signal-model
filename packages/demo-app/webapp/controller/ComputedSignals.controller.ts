import Controller from "sap/ui/core/mvc/Controller";
import SignalModel from "ui5/model/signal/SignalModel";

/**
 * @namespace demo.app.controller
 */
export default class ComputedSignals extends Controller {
  override onInit(): void {
    const model = this.getView()!.getModel() as SignalModel;
    model.createComputed("/fullName", ["/firstName", "/lastName"], (first, last) => {
      return `${first} ${last}`;
    });
    model.createComputed("/birthYear", ["/age"], (age) => {
      return new Date().getFullYear() - (age as number);
    });
  }
}
