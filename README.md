# ui5-lib-signal-model

A reactive, signal-based UI5 model that is a drop-in replacement for JSONModel. Uses the [TC39 Signals proposal](https://github.com/tc39/proposal-signals) polyfill internally, replacing poll-based `checkUpdate()` with push-based, path-specific signal notifications.

## Installation

```bash
npm install ui5-lib-signal-model
```

Add to your `ui5.yaml` dependencies and `manifest.json`:

```json
"sap.ui5": {
  "dependencies": {
    "libs": {
      "ui5.model.signal": {}
    }
  }
}
```

## Usage

```typescript
import SignalModel from "ui5/model/signal/SignalModel";

// Drop-in replacement for JSONModel
const model = new SignalModel({
  customer: { name: "Alice", age: 28 },
  orders: [],
});

// Works with standard XML view bindings
// {/customer/name}, {/orders}, etc.
```

## Feature Comparison: SignalModel vs JSONModel

| Feature                        | JSONModel                                                         | SignalModel                                                       |
| ------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Update mechanism**           | Poll-based: `checkUpdate()` iterates all bindings on every change | Push-based: only bindings to changed paths are notified           |
| **Notification granularity**   | O(n) on total bindings per `setProperty` call                     | O(1) for leaf writes, O(k) for branch writes (k = child bindings) |
| **Change detection**           | `deepEqual` comparison on every binding                           | Signal identity: no comparison needed                             |
| **Binding API**                | `{/path}` in XML views                                            | Identical: `{/path}` in XML views                                 |
| **setProperty / getProperty**  | Standard API                                                      | Same API, same signatures                                         |
| **setData (replace)**          | Replaces data, notifies all bindings                              | Replaces data, fires all signals                                  |
| **setData (merge)**            | Merges data, notifies all bindings                                | Merges data, fires only changed signals                           |
| **mergeProperty**              | Not available                                                     | Surgical merge at any path, fires only changed signals            |
| **Computed/derived values**    | Not available (use formatters)                                    | `createComputed("/path", deps, fn)` for model-layer derived state |
| **Programmatic signal access** | Not available                                                     | `getSignal("/path")` returns underlying Signal.State              |
| **Strict mode**                | Not available                                                     | `{ strict: true }` throws on nonexistent paths                    |
| **TypeScript generics**        | Via TypedJSONModel wrapper                                        | Built-in: `new SignalModel<T>(data)` with path autocompletion     |
| **Two-way binding**            | Supported                                                         | Supported (identical behavior)                                    |
| **List binding**               | Filter + Sort via FilterProcessor/SorterProcessor                 | Same (reuses ClientListBinding internals)                         |
| **Expression binding**         | Supported                                                         | Supported (benefits from push-based dependency notification)      |
| **TC39 Signals alignment**     | N/A                                                               | Uses signal-polyfill; swap for native Signal when spec ships      |

## API

### Constructor

```typescript
new SignalModel(data, options?)
// options: { strict?: boolean }
```

### JSONModel-Compatible Methods

```typescript
model.setProperty("/path", value)
model.getProperty("/path")
model.setData(data, merge?)
model.getData()
model.bindProperty("/path")
model.bindList("/path")
```

### Extended Methods

```typescript
// Merge writes (only fire changed paths)
model.mergeProperty("/customer", { age: 30 });

// Computed signals
model.createComputed("/fullName", ["/firstName", "/lastName"], (first, last) => `${first} ${last}`);
model.removeComputed("/fullName");

// Direct signal access
const signal = model.getSignal("/path");
signal.get(); // read
signal.set(v); // write
```

## Development

```bash
npm install
npm run start       # demo app
npm run start:lib   # library dev server
npm run test:qunit  # run QUnit tests
npm run check       # lint + typecheck
```

## License

MIT
