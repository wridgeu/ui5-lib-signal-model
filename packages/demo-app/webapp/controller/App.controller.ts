import Controller from "sap/ui/core/mvc/Controller";
import type Event from "sap/ui/base/Event";
import type UIComponent from "sap/ui/core/UIComponent";

/**
 * @namespace demo.app.controller
 */
export default class App extends Controller {
  onNavChange(oEvent: Event): void {
    const sKey = (oEvent.getParameter("item") as { getKey: () => string }).getKey();
    (this.getOwnerComponent() as UIComponent).getRouter().navTo(sKey);
  }
}
