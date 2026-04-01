import UIComponent from "sap/ui/core/UIComponent";
import SignalModel from "ui5/model/signal/SignalModel";
import JSONModel from "sap/ui/model/json/JSONModel";
import { getSampleData } from "./model/sampleData";

/**
 * @namespace demo.app
 */
export default class Component extends UIComponent {
  public static metadata = {
    manifest: "json",
    interfaces: ["sap.ui.core.IAsyncContentCreation"],
  };

  override init(): void {
    super.init();

    const signalModel = new SignalModel(getSampleData());
    this.setModel(signalModel);

    const jsonModel = new JSONModel(getSampleData());
    this.setModel(jsonModel, "json");

    this.getRouter().initialize();
  }
}
