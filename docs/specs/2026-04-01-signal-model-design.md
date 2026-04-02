# SignalModel Design Spec

A reactive, signal-based UI5 model that is a drop-in replacement for JSONModel. It uses the TC39 Signals proposal polyfill (`signal-polyfill`) internally, replacing the poll-based `checkUpdate()` loop with direct, path-specific signal notifications.

## Goals

- Drop-in replacement for JSONModel: same `setProperty`, `getProperty`, `setData`, `bindProperty`, `bindList` API
- Push-based reactivity: only bindings to changed paths are notified, eliminating O(n) binding iteration
- TC39-aligned: uses `signal-polyfill` so native `Signal` can replace it when the proposal ships
- Full TypeScript generics with path autocompletion and type inference (following `TypedJSONModel` patterns)
- Expose signal primitives for power users via `getSignal()` and `createComputed()`

## Non-Goals

- Standalone signal primitive outside UI5 (no framework-agnostic layer)
- Server-side model / OData integration (composition pattern works: OData fetches, SignalModel holds)
- Proxy-based transparent reactivity (explicit `setProperty` API, not property interception)

## Architecture

```
XML View bindings: {/customer/name}, {/orders}
        |
        | bindProperty / bindList
        v
SignalPropertyBinding / SignalListBinding
  - Each subscribes to its path's signal via Watcher
  - No checkUpdate polling -- push-based only
        |
        | reads / subscribes
        v
Signal Registry (Map<string, Signal.State | Signal.Computed>)
  - Signals created lazily on first bind
  - "/customer/name"  -> Signal.State("Alice")
  - "/orders"         -> Signal.State([...])
  - "/fullName"       -> Signal.Computed(...)
        |
        | setProperty writes to signal
        v
SignalModel (extends ClientModel)
  - this.oData = raw JS object (source of truth)
  - setProperty -> update oData + signal.set()
  - setData -> update oData + invalidate signals
```

### Key Flow: setProperty("/customer/name", "John")

1. Update `this.oData.customer.name = "John"` (same as JSONModel)
2. Look up `"/customer/name"` in signal registry
3. If signal exists: `signal.set("John")` -- only bindings watching this exact path are notified
4. Check for parent path signals (`"/customer"`, `"/"`) and invalidate them
5. No iteration over unrelated bindings

## Inheritance

```
MessageProcessor
    -> Model (abstract)
        -> ClientModel (abstract)
            -> SignalModel (concrete)
```

Extends `ClientModel` like JSONModel. Reuses `createBindingContext()`, `loadData()`, AJAX utilities, data caching from `ClientModel`.

## Signal Registry

A `Map<string, Signal.State | Signal.Computed>` mapping absolute paths to signals.

### Lazy Creation

Signals are created on demand when a binding requests a path. No signal exists until something binds to it. This avoids upfront cost for unbound data.

### Write Semantics

**Leaf write:**

```
setProperty("/customer/name", "John")
  -> this.oData.customer.name = "John"
  -> registry.get("/customer/name")?.set("John")       // direct subscribers
  -> registry.get("/customer")?.set(this.oData.customer) // parent if bound
  -> registry.get("/")?.set(this.oData)                  // root if bound
```

**Branch write -- replace (default):**

```
setProperty("/customer", { name: "Bob", age: 30 })
  -> Replaces entire object in oData
  -> Fires ALL signals under "/customer/*" path prefix
  -> Clean slate: no diffing, predictable behavior
```

**Branch write -- merge (via mergeProperty):**

```
mergeProperty("/customer", { age: 31 })
  -> Merges into existing data: { name: "Bob", age: 31 }
  -> Only fires signals for paths that actually changed
  -> Surgical: "/customer/age" fires, "/customer/name" does not
```

**setData -- replace vs merge:**

```
setData(newData)           // replace: all signals fire
setData(partial, true)     // merge: only changed paths fire
```

### Computed Signals

```typescript
model.createComputed("/fullName", ["/firstName", "/lastName"], (first, last) => `${first} ${last}`);
```

- Creates `Signal.Computed` in the registry at the given path
- Read-only: `setProperty` on a computed path throws
- Bindings to computed paths work identically to raw data paths
- `removeComputed(path)` cleans up

**Conflict rules:**

- Computed on empty path: creates it
- Computed on existing raw data path: throws (almost certainly a bug)
- `setProperty` on computed path: throws (read-only)
- Computed on existing computed path: replaces previous computation (last definition wins)
- In strict mode all conflicts throw; in permissive mode computed-on-computed replaces with console warning

## Binding Classes

### SignalPropertyBinding (extends ClientPropertyBinding)

- On construction: subscribes to the path's signal via a `Watcher`
- When signal fires: calls `_fireChange({ reason: ChangeReason.Change })` directly -- no `deepEqual`, no polling
- `setValue()` for two-way: calls `model.setProperty()` which sets the signal, which notifies other bindings on the same path
- `destroy()`: unsubscribes the watcher

### SignalListBinding (extends ClientListBinding)

- Subscribes to the signal for its list path (e.g., `"/orders"`)
- On signal change: calls `update()` to re-apply filters/sorters, then `_fireChange`
- Reuses `ClientListBinding`'s `applyFilter()` / `applySort()` / extended change detection unchanged

### checkUpdate() Override

- Overridden to be a **no-op** for normal property changes (signals handle notification directly)
- For `setData()` (full replacement): walks all signals in the registry to re-evaluate
- For `resume()` (unsuspend): re-evaluates relevant signals
- `checkPerformanceOfUpdate` warning becomes irrelevant

### Reused Without Changes

- `createBindingContext()` -- synchronous, works as-is
- `loadData()` / AJAX -- works as-is, calls `setData()` on completion
- `FilterProcessor.apply()` / `SorterProcessor.apply()` -- untouched
- Extended change detection diffing -- untouched
- Context caching in `mContexts` -- untouched

## TypeScript API

### Generic Model Typing

```typescript
interface CustomerData {
  customer: { name: string; age: number };
  orders: Order[];
}

const model = new SignalModel<CustomerData>({
  customer: { name: "Alice", age: 28 },
  orders: [],
});

model.getProperty("/customer/name"); // typed as string
model.setProperty("/customer/age", 31); // type-checked
model.setProperty("/customer/age", "x"); // compile error
```

### Drop-in API (JSONModel compatible)

```typescript
setProperty(path, value, context?, bAsyncUpdate?): boolean
getProperty(path, context?): T
setData(data, bMerge?): void
getData(): T
loadData(url, ...): Promise<void>
bindProperty(path, context?, params?): SignalPropertyBinding
bindList(path, context?, sorters?, filters?, params?): SignalListBinding
```

### Extended API (signal access + merge)

```typescript
getSignal(path): Signal.State<T>
createComputed(path, deps, fn): Signal.Computed<T>
removeComputed(path): void
mergeProperty(path, value, context?): boolean  // merge-write shorthand
```

Note: `setProperty` keeps the exact JSONModel signature (4 params). Merge writes for branch paths use the dedicated `mergeProperty()` method to avoid overloading `setProperty` with a 5th parameter that JSONModel doesn't have. `setData(data, bMerge)` keeps its existing JSONModel merge parameter.

### Constructor

```typescript
new SignalModel<T>(data: T, options?: {
  strict?: boolean;   // throw on nonexistent paths (default: false)
})
```

## Strict Mode

When `strict: true`:

- `setProperty` on a nonexistent path throws `TypeError`
- All computed signal conflict cases throw
- Catches typos and stale paths early

When `strict: false` (default):

- Same permissive behavior as JSONModel (auto-creates paths)
- Computed-on-computed replaces with console warning

## Project Structure

```
ui5-lib-signal-model/
  package.json                    # workspaces: ["packages/*"]
  tsconfig.base.json              # TypeScript ~6.0, strict
  .oxlintrc.json / .oxfmtrc.json  # linting/formatting
  .husky/ + commitlint            # commit hooks

  packages/
    lib/
      package.json                # "ui5-lib-signal-model"
      ui5.yaml                    # ui5-tooling-transpile
      src/
        .library                  # UI5 library descriptor
        manifest.json             # namespace: ui5.model.signal
        library.ts
        SignalModel.ts
        SignalPropertyBinding.ts
        SignalListBinding.ts
        SignalRegistry.ts
        types.ts
      test/qunit/

    demo-app/
      package.json                # "ui5-lib-signal-model-demo"
      ui5.yaml
      webapp/
        manifest.json
        Component.ts
        controller/Main.controller.ts
        view/Main.view.xml
```

### Dependencies

- `signal-polyfill` -- TC39 Signals reference polyfill
- `@ui5/cli` -- build tooling
- `ui5-tooling-transpile` -- TypeScript transpilation
- `typescript` ~6.0
- `oxlint` + `oxfmt`
- `@wdio/cli` + `wdio-qunit-service` -- testing

No release-please for initial setup.

## Demo App Showcase

1. **Property binding** -- inputs bound to signal model paths, reactive updates
2. **List binding** -- table with filtering/sorting
3. **Computed signals** -- derived paths like `/fullName`
4. **getSignal()** -- programmatic signal access in controller
5. **Strict mode** -- toggle to show error behavior on invalid paths
6. **JSONModel comparison** -- side-by-side with same data/bindings showing behavioral equivalence

## README

The library README includes a feature comparison table between SignalModel and JSONModel covering: update mechanism, notification granularity, computed support, TypeScript generics, strict mode, and API compatibility.
