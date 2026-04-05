import type SegmentedButton from "sap/m/SegmentedButton";
import BaseController from "./BaseController";

/**
 * @namespace demo.app.controller
 */
export default class App extends BaseController {
  onNavChange(): void {
    const navButton = this.byId("navButton") as SegmentedButton;
    const sKey = navButton.getSelectedKey();
    this.getRouter().navTo(sKey);
  }
}
