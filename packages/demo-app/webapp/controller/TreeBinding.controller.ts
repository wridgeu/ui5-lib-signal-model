import Controller from "sap/ui/core/mvc/Controller";
import SignalModel from "ui5/model/signal/SignalModel";

/**
 * @namespace demo.app.controller
 */
export default class TreeBinding extends Controller {
  override onInit(): void {
    const treeModel = new SignalModel({
      org: [
        {
          name: "Alice Johnson",
          role: "CEO",
          reports: [
            {
              name: "Bob Smith",
              role: "CTO",
              reports: [
                { name: "Carol White", role: "Lead Developer", reports: [] },
                { name: "Dave Brown", role: "Senior Developer", reports: [] },
              ],
            },
            {
              name: "Eve Davis",
              role: "CFO",
              reports: [{ name: "Frank Wilson", role: "Accountant", reports: [] }],
            },
          ],
        },
      ],
    });
    this.getView()!.setModel(treeModel, "tree");
  }

  onAddEmployee(): void {
    const model = this.getView()!.getModel("tree") as SignalModel;
    const ctoReports = model.getProperty("/org/0/reports/0/reports") as unknown[];
    const updated = [...ctoReports, { name: "New Hire", role: "Developer", reports: [] }];
    model.setProperty("/org/0/reports/0/reports", updated);
  }
}
