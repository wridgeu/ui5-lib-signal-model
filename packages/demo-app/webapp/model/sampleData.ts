export interface SampleData {
  firstName: string;
  lastName: string;
  age: number;
  email: string;
  items: Array<{
    id: number;
    name: string;
    price: number;
    active: boolean;
  }>;
}

export function getSampleData(): SampleData {
  return {
    firstName: "Alice",
    lastName: "Smith",
    age: 28,
    email: "alice@example.com",
    items: [
      { id: 1, name: "Widget A", price: 29.99, active: true },
      { id: 2, name: "Widget B", price: 49.99, active: false },
      { id: 3, name: "Widget C", price: 19.99, active: true },
      { id: 4, name: "Gadget D", price: 99.99, active: true },
      { id: 5, name: "Gadget E", price: 14.99, active: false },
    ],
  };
}
