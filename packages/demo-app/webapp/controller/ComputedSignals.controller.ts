import BaseController from "./BaseController";

interface Item {
  id: number;
  name: string;
  price: number;
  active: boolean;
}

/**
 * @namespace demo.app.controller
 */
export default class ComputedSignals extends BaseController {
  override onInit(): void {
    const model = this.getModel();

    // Scalar computed -- derived from two dependencies
    model.createComputed("/fullName", ["/firstName", "/lastName"], (first, last) => {
      return `${first} ${last}`;
    });
    model.createComputed("/birthYear", ["/age"], (age) => {
      return new Date().getFullYear() - (age as number);
    });

    // Computed object -- sub-path traversal (/mostExpensive/name, /mostExpensive/price)
    model.createComputed("/mostExpensive", ["/items"], (items) => {
      const arr = items as Item[];
      return arr.reduce((best, cur) => (cur.price > best.price ? cur : best), arr[0]);
    });

    // Computed array -- list binding on filtered results
    model.createComputed("/activeItems", ["/items"], (items) => {
      return (items as Item[]).filter((i) => i.active);
    });

    // Computed scalar from computed array -- chained dependency
    model.createComputed("/activeTotal", ["/activeItems"], (activeItems) => {
      return (activeItems as Item[]).reduce((sum, i) => sum + i.price, 0).toFixed(2);
    });
  }

  override onExit(): void {
    const model = this.getModel();
    model.removeComputed("/activeTotal");
    model.removeComputed("/activeItems");
    model.removeComputed("/mostExpensive");
    model.removeComputed("/birthYear");
    model.removeComputed("/fullName");
  }
}
