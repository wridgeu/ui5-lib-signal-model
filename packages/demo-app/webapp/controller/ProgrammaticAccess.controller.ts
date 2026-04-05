import type Text from "sap/m/Text";
import type Input from "sap/m/Input";
import BaseController from "./BaseController";

/**
 * @namespace demo.app.controller
 */
export default class ProgrammaticAccess extends BaseController {
  onReadSignal(): void {
    const model = this.getModel();
    const signal = model.getSignal("/firstName");
    const display = this.byId("signalValue") as Text;
    display.setText(String(signal.get()));
  }

  onWriteSignal(): void {
    const model = this.getModel();
    const input = this.byId("writeInput") as Input;
    const value = input.getValue();

    if (value) {
      model.setProperty("/firstName", value);
      input.setValue("");
    }
  }
}
