import Controller from "sap/ui/core/mvc/Controller";
import type SegmentedButton from "sap/m/SegmentedButton";
import type UIComponent from "sap/ui/core/UIComponent";

/**
 * @namespace demo.app.controller
 */
export default class App extends Controller {
  onNavChange(): void {
    const navButton = this.byId("navButton") as SegmentedButton;
    const sKey = navButton.getSelectedKey();
    (this.getOwnerComponent() as UIComponent).getRouter().navTo(sKey);
  }
}
