import BaseController from "./BaseController";
import { getSampleData } from "../model/sampleData";

/**
 * @namespace demo.app.controller
 */
export default class PropertyBinding extends BaseController {
  onReset(): void {
    const model = this.getModel();
    const data = getSampleData();
    model.setProperty("/firstName", data.firstName);
    model.setProperty("/lastName", data.lastName);
    model.setProperty("/age", data.age);
    model.setProperty("/email", data.email);
  }
}
