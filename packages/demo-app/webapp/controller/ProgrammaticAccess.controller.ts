import Controller from "sap/ui/core/mvc/Controller";
import SignalModel from "ui5/model/signal/SignalModel";
import type Text from "sap/m/Text";
import type Input from "sap/m/Input";

/**
 * @namespace demo.app.controller
 */
export default class ProgrammaticAccess extends Controller {
  onReadSignal(): void {
    const model = this.getView()!.getModel() as SignalModel;
    const signal = model.getSignal("/firstName");
    const display = this.byId("signalValue") as Text;
    display.setText(String(signal.get()));
  }

  onWriteSignal(): void {
    const model = this.getView()!.getModel() as SignalModel;
    const input = this.byId("writeInput") as Input;
    const value = input.getValue();

    if (value) {
      model.setProperty("/firstName", value);
      input.setValue("");
    }
  }
}
