import SignalModel from "../src/SignalModel";

type TestData = {
  name: string;
  age: number;
  customer: {
    firstName: string;
    lastName: string;
  };
  items: Array<{ id: number; label: string }>;
};

const model = new SignalModel<TestData>({
  name: "test",
  age: 30,
  customer: { firstName: "Alice", lastName: "Smith" },
  items: [{ id: 1, label: "A" }],
});

// These should compile without error:
const _name: string = model.getProperty("/name");
const _age: number = model.getProperty("/age");
const _firstName: string = model.getProperty("/customer/firstName");
const _data: TestData = model.getData();

model.setProperty("/name", "Bob");
model.setProperty("/age", 31);
model.setProperty("/customer/firstName", "Carol");

// These should be type errors (commented out to not break compilation):
// model.setProperty("/name", 42);          // Error: 42 is not string
// model.setProperty("/nonexistent", "x");  // Error: not a valid path
// const x: number = model.getProperty("/name"); // Error: string not assignable to number

// Untyped model still works:
const untyped = new SignalModel({ foo: "bar" });
untyped.getProperty("/foo"); // inferred as string
untyped.setProperty("/foo", "baz");

// Suppress unused variable warnings
void _name;
void _age;
void _firstName;
void _data;
