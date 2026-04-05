import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import Sorter from "sap/ui/model/Sorter";
import type ListBinding from "sap/ui/model/ListBinding";
import type Table from "sap/m/Table";
import type SearchField from "sap/m/SearchField";
import type Event from "sap/ui/base/Event";
import BaseController from "./BaseController";

/**
 * @namespace demo.app.controller
 */
export default class ListBindingController extends BaseController {
  private getItemsBinding(): ListBinding {
    const table = this.byId("itemsTable") as Table;
    return table.getBinding("items") as unknown as ListBinding;
  }

  onFilter(oEvent: Event): void {
    const sQuery = (oEvent.getSource() as unknown as SearchField).getValue();
    const binding = this.getItemsBinding();
    const filters = sQuery ? [new Filter("name", FilterOperator.Contains, sQuery)] : [];
    binding.filter(filters);
  }

  onSortName(): void {
    this.getItemsBinding().sort(new Sorter("name"));
  }

  onSortPrice(): void {
    this.getItemsBinding().sort(new Sorter("price"));
  }

  onClearSort(): void {
    this.getItemsBinding().sort([]);
  }

  onAddItem(): void {
    const model = this.getModel();
    const items = (model.getProperty("/items") as unknown[]).slice();
    const newId = items.length + 1;
    items.push({ id: newId, name: `New Item ${newId}`, price: 9.99, active: true });
    model.setProperty("/items", items);
  }
}
