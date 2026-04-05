import SignalModel from "ui5/model/signal/SignalModel";
import BaseController from "./BaseController";

/**
 * @namespace demo.app.controller
 */
export default class TreeBinding extends BaseController {
  private treeModel: SignalModel | null = null;

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
    this.treeModel = treeModel;
    // oxlint-disable-next-line typescript/no-non-null-assertion -- always defined in controller lifecycle
    this.getView()!.setModel(treeModel, "tree");
  }

  onAddEmployee(): void {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- assigned in onInit
    const model = this.treeModel!;
    const ctoReports = model.getProperty("/org/0/reports/0/reports") as unknown[];
    const updated = [...ctoReports, { name: "New Hire", role: "Developer", reports: [] }];
    model.setProperty("/org/0/reports/0/reports", updated);
  }

  override onExit(): void {
    this.treeModel?.destroy();
    this.treeModel = null;
  }
}
