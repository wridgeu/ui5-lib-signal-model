import Controller from "sap/ui/core/mvc/Controller";
import SignalModel from "ui5/model/signal/SignalModel";
import type Input from "sap/m/Input";
import type MessageStrip from "sap/m/MessageStrip";

/**
 * @namespace demo.app.controller
 */
export default class StrictMode extends Controller {
  private strictModel: SignalModel | null = null;

  override onInit(): void {
    this.strictModel = new SignalModel({ name: "Alice", age: 28 }, { strict: true });
    this.getView()!.setModel(this.strictModel, "strict");
  }

  onSetStrict(): void {
    const path = (this.byId("pathInput") as Input).getValue();
    const value = (this.byId("valueInput") as Input).getValue();
    const result = this.byId("result") as MessageStrip;

    try {
      this.strictModel!.setProperty(path, value);
      result.setText(`Set "${path}" = "${value}"`);
      result.setType("Success");
    } catch (e) {
      result.setText(`Error: ${(e as Error).message}`);
      result.setType("Error");
    }
    result.setVisible(true);
  }

  override onExit(): void {
    this.strictModel?.destroy();
    this.strictModel = null;
  }
}
