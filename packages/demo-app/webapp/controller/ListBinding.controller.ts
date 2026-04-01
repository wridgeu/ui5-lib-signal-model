import Controller from "sap/ui/core/mvc/Controller";
import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import Sorter from "sap/ui/model/Sorter";
import SignalModel from "ui5/model/signal/SignalModel";
import type Table from "sap/m/Table";
import type Event from "sap/ui/base/Event";

/**
 * @namespace demo.app.controller
 */
export default class ListBinding extends Controller {
  onFilter(oEvent: Event): void {
    const sQuery = (oEvent.getSource() as { getValue: () => string }).getValue();
    const table = this.byId("itemsTable") as Table;
    const binding = table.getBinding("items")!;

    const filters = sQuery ? [new Filter("name", FilterOperator.Contains, sQuery)] : [];
    binding.filter(filters);
  }

  onSortName(): void {
    const table = this.byId("itemsTable") as Table;
    table.getBinding("items")!.sort(new Sorter("name"));
  }

  onSortPrice(): void {
    const table = this.byId("itemsTable") as Table;
    table.getBinding("items")!.sort(new Sorter("price"));
  }

  onClearSort(): void {
    const table = this.byId("itemsTable") as Table;
    table.getBinding("items")!.sort([]);
  }

  onAddItem(): void {
    const model = this.getView()!.getModel() as SignalModel;
    const items = model.getProperty("/items") as unknown[];
    const newId = items.length + 1;
    items.push({ id: newId, name: `New Item ${newId}`, price: 9.99, active: true });
    model.setProperty("/items", [...items]);
  }
}
