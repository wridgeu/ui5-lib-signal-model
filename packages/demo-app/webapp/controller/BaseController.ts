import Controller from "sap/ui/core/mvc/Controller";
import type UIComponent from "sap/ui/core/UIComponent";
import type Router from "sap/ui/core/routing/Router";
import type SignalModel from "ui5/model/signal/SignalModel";

/**
 * @namespace demo.app.controller
 */
export default class BaseController extends Controller {
  getRouter(): Router {
    return (this.getOwnerComponent() as UIComponent).getRouter();
  }

  getModel(sName?: string): SignalModel {
    return (this.getOwnerComponent() as UIComponent).getModel(sName) as SignalModel;
  }
}
