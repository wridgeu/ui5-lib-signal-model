<h1 align="center">ui5-lib-signal-model</h1>

<p align="center">A reactive, signal-based UI5 model that replaces JSONModel as a drop-in. Uses the <a href="https://github.com/tc39/proposal-signals">TC39 Signals proposal</a> polyfill internally, replacing poll-based <code>checkUpdate()</code> with push-based, path-specific signal notifications.</p>

> [!CAUTION]
> This is an **experimental proof of concept** exploring reactive primitives in the UI5 ecosystem. Treat it as a technical exploration and learning exercise, not a production-ready library.
>
> A minor version may be published to npm so that others can try it out and experiment. This does **not** indicate production readiness. The API surface may change without notice between releases.

## Requirements

- **UI5**: OpenUI5/SAPUI5 >= 1.144.0
- **Node.js**: >= 22
- **Runtime dependency**: [`signal-polyfill`](https://github.com/proposal-signals/signal-polyfill) ^0.2.2 (TC39 Signals reference implementation, pre-1.0)

## Installation

```bash
npm install ui5-lib-signal-model
```

The library ships its own `ui5.yaml` (`type: library`), so UI5 Tooling auto-discovers it from `node_modules`.

Add the runtime dependency to your `manifest.json`:

```json
"sap.ui5": {
  "dependencies": {
    "libs": {
      "ui5.model.signal": {}
    }
  }
}
```

For **TypeScript** projects, add the library to `types` in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["@openui5/types", "ui5-lib-signal-model"]
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

### Typed Model

```typescript
interface AppData {
  customer: { name: string; age: number };
  orders: Array<{ id: number; total: number }>;
}

const model = new SignalModel<AppData>({
  customer: { name: "Alice", age: 28 },
  orders: [],
});

model.getProperty("/customer/name"); // string (typed)
model.setProperty("/customer/age", 31); // type-checked
model.setProperty("/customer/age", "x"); // compile error
```

Path types follow the same conventions as UI5's typed model patterns from `@openui5/types`.

### Declarative Binding

SignalModel works with standard UI5 declarative bindings in XML views, one-way and two-way:

```xml
<!-- Property binding -->
<Input value="{/customer/name}" />
<Text text="{/customer/name}" />

<!-- List binding -->
<List items="{/orders}">
  <StandardListItem title="{id}" description="{total}" />
</List>

<!-- Tree binding -->
<Tree items="{path: '/org', parameters: {arrayNames: ['children']}}">
  <StandardTreeItem title="{name}" />
</Tree>

<!-- Named model -->
<Text text="{signals>/customer/name}" />

<!-- Expression binding -->
<Text text="{= ${/customer/name} + ' (' + ${/customer/age} + ')'}" />
```

### Computed Signals

Derived values that update automatically when dependencies change:

```typescript
model.createComputed("/fullName", ["/firstName", "/lastName"], (first, last) => `${first} ${last}`);

// Bind to it like any other path
// <Text text="{/fullName}" />
```

### Computed Signal Immutability

Computed signals are **define-once**: calling `createComputed` on a path that already holds a computed or a state signal (i.e., a path already accessed through a binding or `getSignal`) throws a `TypeError`. To redefine an existing computed, call `removeComputed` first.

```typescript
model.createComputed("/total", ["/price", "/tax"], (p, t) => p * (1 + t));

// Throws — computed already exists at /total:
model.createComputed("/total", ["/price"], (p) => p);

// Correct — remove first, then redefine:
model.removeComputed("/total");
model.createComputed("/total", ["/price"], (p) => p);
```

> **Why define-once?** Both the [TC39 Signals proposal](https://github.com/tc39/proposal-signals) and [MobX 6](https://mobx.js.org/computeds.html) treat computed values as immutable. A `Signal.Computed`'s derivation function is fixed at construction. MobX 6 enforces "every field can be annotated only once" and provides no public API to replace a `ComputedValue`'s derivation. UI5 formatters, the closest existing equivalent, are also fixed in code and never replaced at runtime.
>
> **Declarative binding bridge.** Computed signals follow immutability semantics from TC39 Signals and MobX, but the UI5 world is not purely programmatic. Bindings are often declared in XML views (`{/total}`) and managed by the framework; the developer cannot manually destroy and recreate them. When `removeComputed` + `createComputed` redefines a computed at a path, all existing bindings to that path automatically re-subscribe to the new signal. This way, XML view bindings see the new derivation even if it has entirely different dependencies. The cost is one `Map<string, Set<callback>>` lookup per `createComputed` call (a no-op when no bindings exist) and one callback registration per binding in `subscribe`/`unsubscribe`.

### Computed Sub-Path Traversal

When a computed signal returns an object or array, you can bind to paths **inside** that return value. The model traverses into the computed value automatically:

```typescript
model.createComputed("/currentUser", ["/users", "/selectedId"], (users, id) => users[id]);

// Bind to sub-paths — these read through the computed's return value
// <Text text="{/currentUser/name}" />
// <Text text="{/currentUser/email}" />

// List binding on a computed array works too
model.createComputed("/activeItems", ["/items"], (items) => items.filter((i) => i.active));
// <List items="{/activeItems}"> <StandardListItem title="{name}" /> </List>
```

In a path like `/currentUser/name`, the model resolves `/currentUser` as a computed signal, calls its derivation function, then navigates `.name` within the returned object. Only **one** computed "pivot" can exist per path — everything below it is plain object traversal.

**Computed paths are read-only.** `setProperty`, `mergeProperty`, and two-way bindings on computed paths (or their sub-paths) return `false` and log a warning. This matches the industry consensus: [Vue](https://vuejs.org/guide/essentials/computed.html), [MobX](https://mobx.js.org/computeds.html), [SolidJS](https://docs.solidjs.com/reference/basic-reactivity/create-memo), and [Angular Signals](https://angular.dev/guide/signals) all treat computeds as read-only.

```typescript
model.setProperty("/currentUser/name", "Bob"); // returns false — computed path is read-only
```

To update the data, write to the **source** path. The computed re-derives automatically and all sub-path bindings update:

```typescript
model.setProperty("/users/0/name", "Bob"); // writes to source data — /currentUser/name updates
```

### Merge Writes

`mergeProperty` performs a **recursive merge** at a specific path. It updates only the properties you provide and leaves the rest untouched. Compare with `setProperty`, which **replaces** the entire value:

```typescript
// Given: /customer = { name: "Alice", age: 28, city: "Berlin" }

// setProperty REPLACES the entire object — name and city are gone:
model.setProperty("/customer", { age: 30 });
// Result: /customer = { age: 30 }

// mergeProperty MERGES into the existing object — name and city survive:
model.mergeProperty("/customer", { age: 30 });
// Result: /customer = { name: "Alice", age: 30, city: "Berlin" }
```

`mergeProperty` only fires signals for paths that actually changed (here, only `/customer/age`). Bindings to `/customer/name` and `/customer/city` are not notified.

`setData(partial, true)` uses the same merge logic starting at the root, equivalent to `mergeProperty("/", partial)`.

## Feature Comparison: SignalModel vs JSONModel

| Feature                        | JSONModel                                                         | SignalModel                                                                      |
| ------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Update mechanism**           | Poll-based: `checkUpdate()` iterates all bindings on every change | Push-based: only bindings to changed paths are notified via signals              |
| **Notification granularity**   | O(_n_) per `setProperty` call                                     | O(_k_) per `setProperty` call                                                    |
| **Change detection**           | `deepEqual` comparison on every binding                           | Signal-based: no comparison for primitives, object-aware for mutations           |
| **Property binding**           | `{/path}` in XML views                                            | Identical                                                                        |
| **List binding**               | Filter + Sort via FilterProcessor/SorterProcessor                 | Same (reuses ClientListBinding internals)                                        |
| **Tree binding**               | JSONTreeBinding with arrayNames                                   | SignalTreeBinding with same arrayNames support                                   |
| **Expression binding**         | Supported                                                         | Supported (benefits from push-based dependency notification)                     |
| **Two-way binding**            | Supported                                                         | Supported (identical behavior)                                                   |
| **Declarative XML binding**    | Supported                                                         | Supported (full lifecycle: one-way, two-way, list, tree)                         |
| **Named models**               | `{modelName>/path}`                                               | Identical                                                                        |
| **Binding modes**              | OneWay, TwoWay, OneTime                                           | Same (inherits from ClientModel)                                                 |
| **Nested bindings**            | Relative paths with context                                       | Same (relative and absolute)                                                     |
| **setProperty / getProperty**  | Standard API                                                      | Same signatures, typed overloads with generics                                   |
| **setData (replace)**          | Replaces data, notifies all bindings                              | Replaces data, fires all signals                                                 |
| **setData (merge)**            | Merges data, notifies all bindings                                | Merges data, fires only changed signals                                          |
| **mergeProperty**              | Not available                                                     | Surgical merge at any path, fires only changed signals                           |
| **Computed/derived values**    | Not available (use formatters)                                    | `createComputed("/path", deps, fn)` for model-layer derived state                |
| **Programmatic signal access** | Not available                                                     | `getSignal("/path")` returns underlying `Signal.State` or `Signal.Computed`      |
| **Path auto-creation**         | Returns `false` for nonexistent parent paths                      | Same by default; `{ autoCreatePaths: true }` creates intermediates automatically |
| **Leaf property guard**        | Not available                                                     | `{ strictLeafCheck: true }` rejects writes to nonexistent leaf properties        |
| **TypeScript generics**        | Via TypedJSONModel wrapper                                        | Built-in: `new SignalModel<T>(data)` with path autocompletion                    |
| **TC39 Signals alignment**     | N/A                                                               | Uses signal-polyfill; swap for native Signal when spec ships                     |

> **Algorithmic complexity legend:**
>
> - **_n_** = total number of bindings registered on the model (all paths combined)
> - **_k_** = number of bindings affected by a single change: the changed path itself, plus its parent paths (e.g. `/customer` when changing `/customer/name`), plus its child paths (e.g. `/customer/name` and `/customer/age` when replacing the `/customer` object)
>
> JSONModel's `checkUpdate()` iterates **all** _n_ bindings on every write, even if only one path changed. SignalModel notifies only the _k_ bindings whose paths are affected. When _k_ ≪ _n_ (typical in large models), SignalModel avoids O(_n_) work per change.

### Configuration Modes

SignalModel defaults to **full JSONModel parity**: `setProperty` returns `false` for nonexistent parent paths, exactly like JSONModel. Two opt-in flags independently extend this behavior, each controlling a different level of the path:

```
model.setProperty("/a/b/c", value)
                   ↑   ↑
                   │   └── LEAF: "c" on parent {b}     ← strictLeafCheck controls this
                   └────── INTERMEDIATE: {a}, {b}       ← autoCreatePaths controls this
```

- **`autoCreatePaths: true`**: Auto-creates intermediate objects when setting a deeply nested path. `model.setProperty("/a/b/c", value)` creates `{a: {b: {}}}` if the parent path doesn't exist, instead of returning `false`. Useful for dynamic form models where the schema isn't known upfront.
- **`strictLeafCheck: true`**: Rejects `setProperty` writes to leaf properties that don't exist on the parent object (returns `false`). JSONModel allows creating new properties on existing parents; this flag prevents it. Useful for catching typos in property names against a known schema.

| `autoCreatePaths` | `strictLeafCheck` | Missing parent | New leaf on existing parent | Use case                         |
| ----------------- | ----------------- | -------------- | --------------------------- | -------------------------------- |
| `false` (default) | `false` (default) | `false`        | creates it                  | JSONModel parity                 |
| `true`            | `false`           | creates it     | creates it                  | Dynamic forms                    |
| `false`           | `true`            | `false`        | `false`                     | Typed schemas                    |
| `true`            | `true`            | creates it     | `false`                     | Scaffold structure, guard leaves |

All other APIs (`setData`, `getData`, `getProperty`, `bindProperty`, `bindList`, `bindTree`) behave identically regardless of configuration.

### TypeScript Generics

SignalModel's typed path system builds on the patterns from UI5's `TypedJSONModel` wrapper in `@openui5/types`. The `ModelPath<T>` and `PathValue<T, P>` utility types follow the same conventions for extracting absolute binding paths and resolving value types. `TypedJSONModel` requires a separate wrapper class; SignalModel has generics built in, so `new SignalModel<T>(data)` gives typed `getProperty` and `setProperty` with path autocompletion directly.

## API

### Constructor

```typescript
// Data constructor (most common)
new SignalModel<T>(data?: T, options?: { autoCreatePaths?: boolean; strictLeafCheck?: boolean })

// URL constructor — loads JSON from a URL (calls loadData internally)
new SignalModel(url: string, options?: { autoCreatePaths?: boolean; strictLeafCheck?: boolean })
```

### JSONModel-Compatible Methods

```typescript
model.setProperty("/path", value);        // returns boolean (true if successful)
model.getProperty("/path");
model.setData(data);                       // replace all data
model.setData(partial, true);              // merge into existing data
model.getData();
model.isList("/path");                     // true if value at path is an array
model.bindProperty("/path");
model.bindList("/path");
model.bindTree("/path", context, filters, { arrayNames: ["children"] }, sorters);

// Load JSON from a URL (fires requestSent/requestCompleted/requestFailed events)
model.loadData(url, params?, async?, method?, merge?, cache?, headers?);

// Promise that resolves when all pending loadData calls complete
await model.dataLoaded();
```

### Extended Methods

```typescript
// Merge writes (only fire changed paths)
model.mergeProperty("/customer", { age: 30 });

// Computed signals
model.createComputed("/fullName", ["/firstName", "/lastName"], (first, last) => `${first} ${last}`);
model.removeComputed("/fullName");

// Direct signal access (read-only recommended)
const signal = model.getSignal("/path");
signal.get(); // read current value
```

### Binding Classes

| Class                   | Extends                 | Purpose                                              |
| ----------------------- | ----------------------- | ---------------------------------------------------- |
| `SignalPropertyBinding` | `ClientPropertyBinding` | Single-value bindings with Watcher push              |
| `SignalListBinding`     | `ClientListBinding`     | List bindings with filter/sort, Watcher push         |
| `SignalTreeBinding`     | `ClientTreeBinding`     | Tree bindings with hierarchy traversal, Watcher push |

## Architecture

```
XML View bindings: {/customer/name}, {/orders}, {path: '/tree', ...}
        |
        | bindProperty / bindList / bindTree
        v
SignalPropertyBinding / SignalListBinding / SignalTreeBinding
  - Each subscribes to its path's signal via Signal.subtle.Watcher
  - Push-based: queueMicrotask batching, no polling
        |
        | reads / subscribes
        v
Signal Registry (two Maps: State signals + Computed signals)
  - Signals created lazily on first access (bind, getSignal, or createComputed dependency)
  - Custom equality: primitives use Object.is, objects always notify
  - Computed signals take precedence over state signals at the same path
        |
        | setProperty / setData / mergeProperty
        v
SignalModel (extends ClientModel)
  - this.oData = raw JS object (source of truth)
  - setProperty -> update oData + set signal + invalidate parents
  - setData replace -> update oData + invalidate all signals
  - setData merge -> update oData + invalidate only merge payload paths
  - mergeProperty -> deep merge + recursive change detection
```

## Testing

QUnit test modules covering unit, integration, and declarative binding. Automated via WDIO + headless Chrome:

```bash
npm run test:qunit
```

## Performance Benchmark

A self-contained benchmark page compares SignalModel vs JSONModel across 19 scenarios: property bindings (`sap.m.Text`), list bindings (`sap.m.List`, `sap.m.Table`), tree bindings (`sap.m.Tree`), expression bindings, computed signals (including redefinition and sub-path traversal), merge strategies, and SAP's `checkPerformanceOfUpdate` threshold (3,449 bindings, 29 consecutive calls exceeding the 100k binding check warning).

```bash
npm run start:bench                                    # browser — interactive
npm run bench                                          # CLI — headless, streams to terminal
npm run bench -- --bindings 1000 --json results.json   # custom config + JSON export
```

> [!NOTE]
> Results vary by hardware, browser engine, and system load. The numbers below are from a single reference run. Run the benchmarks on your own setup for representative numbers.

The benchmark uses alternating A-B execution order, JIT warmup, Bessel-corrected sample statistics, and a three-stage async flush protocol. It directly measures the `checkUpdate` bottleneck documented in [openui5 issue 2600](https://github.com/UI5/openui5/issues/2600).

With default synchronous `setProperty`, **"Update all N bindings"** shows ~15x improvement at 2000 bindings (807ms vs 52ms). The advantage scales super-linearly: JSONModel's cost is O(*n*²) (2000 calls × 2000 bindings checked each), while SignalModel's is O(_n_) (2000 notifications, one per changed path).

With JSONModel's `bAsyncUpdate=true`, both models perform equivalently (~18ms each at 2000 bindings). SignalModel defers signal notifications when `bAsyncUpdate` is set, writing data immediately and syncing all signals in a single `setTimeout` pass — matching JSONModel's batching strategy.

For full data replacement (`setData`), both models perform equivalently. For list/table/tree replace operations, both are equivalent because DOM rendering cost dominates. In-place merge shines at scale: merging 3 items into 20,000 is **4.20x faster** because JSONModel deep-clones all 20,000 items while SignalModel touches only the 3 payload keys.

The checkPerformanceOfUpdate scenario reproduces SAP's 100k threshold: 3,449 bindings with 29 consecutive sync calls, **3.91x faster** (27ms vs 7ms).

Full-page reference screenshots for each binding count: [100](docs/img/benchmark-100-bindings.png) | [500](docs/img/benchmark-500-bindings.png) | [1000](docs/img/benchmark-1000-bindings.png) | [2000](docs/img/benchmark-2000-bindings.png)

See [packages/lib/test/benchmark/README.md](packages/lib/test/benchmark/README.md) for the full analysis.

## Demo Application

7 interactive showcase pages:

- **Properties** - two-way form binding with live display
- **List** - table with filter, sort, add item
- **Tree** - org chart hierarchy with add employee
- **Computed** - derived fullName and birthYear
- **Programmatic** - getSignal() direct access
- **Strict** - error display for invalid paths
- **Comparison** - side-by-side SignalModel vs JSONModel

```bash
npm run start  # opens demo app
```

## Learnings

Implementation-level optimizations that contribute to SignalModel's performance, documented as reference for anyone building reactive primitives on top of UI5 or the TC39 Signals proposal.

### Unified Microtask Flush Queue

Each binding type (property, list, tree) subscribes to its path's signal via `Signal.subtle.Watcher`. When a signal changes, the Watcher callback fires synchronously, but `checkUpdate()` is not called immediately. All bindings share a single flush queue (`FlushQueue.ts`) that batches updates into one `queueMicrotask`:

- **One microtask per synchronous block**, regardless of how many bindings or binding types are notified.
- **Map-based deduplication**: `Map<binding, signal>` ensures each binding appears at most once. Rapid-fire `setProperty` calls (e.g., updating 10 fields in a loop) produce exactly one `checkUpdate` per affected binding.
- **Watcher re-arm protocol**: The TC39 Watcher fires at most once between `watch()` calls. The flush reads the current value (`signal.get()`, consuming the notification), re-arms the watcher (`watcher.watch()`, listening for the next change), then fires the UI change (`checkUpdate()`).

When `bAsyncUpdate=true` is passed to `setProperty`, this entire path is bypassed. Data is written immediately without signal notification, and a single `setTimeout` syncs all signals afterward via `registry.invalidateAll()`. See [Batching and `bAsyncUpdate`](#batching-and-basyncupdate).

### In-Place Merge (Eliminating `deepExtend`)

UI5's `JSONModel.setData(data, true)` uses `sap/base/util/deepExtend` to deep-clone the entire model data and then overlay the merge payload. For a model with 1000 items where you merge 5, this clones all 1000, doing O(n) work for an O(k) operation.

SignalModel replaces this with an **in-place recursive merge** (`_mergeInPlace`) that:

1. Walks only the merge payload keys (not the entire data tree)
2. Compares old vs new values inline (no separate invalidation pass)
3. Overwrites changed values directly in `this.oData`
4. Fires signals for changed paths as it goes
5. Uses `structuredClone()` for incoming object/array values to prevent external mutation

This reduces `setData(partial, true)` from O(n) to O(k) where k is the payload size. The improvement is largest for shallow merges into large datasets, common in form-based Fiori apps that update a few fields at a time.

### `structuredClone` over `deepExtend` for Deep Copies

Where a pure deep clone is needed (not a merge), `structuredClone()` replaces `deepExtend({}, source)`. This applies to `SignalListBinding.update()`, which copies list data for UI5's extended change detection. `structuredClone` is implemented natively in C++ by the browser engine and avoids the overhead of UI5's JavaScript-based recursive clone.

### Batching and `bAsyncUpdate`

JSONModel's `setProperty` accepts a `bAsyncUpdate` flag that defers `checkUpdate` into a `setTimeout`, collapsing N synchronous `setProperty` calls into a single binding check pass. This is SAP's recommended workaround for the O(N²) problem documented in [openui5 issue 2600](https://github.com/UI5/openui5/issues/2600).

SignalModel supports this flag. When `bAsyncUpdate=true`, signal notifications are deferred — the data is written immediately but signal updates are batched into a single `setTimeout` pass that syncs all signals afterward. Both models perform equivalently in this scenario (~18ms each at 2000 bindings). Without the flag (default), SignalModel uses its push-based microtask flush which provides O(1) per-path notification.

### Microtask vs Macrotask Scheduling

SignalModel has two scheduling paths depending on how `setProperty` is called:

- **Default (no `bAsyncUpdate`):** signal changes fire synchronously, and the FlushQueue batches binding updates via `queueMicrotask`. Microtasks run before the browser paints, so the first frame always shows correct data. One paint, always consistent.
- **`bAsyncUpdate=true`:** signal notifications are skipped entirely during the `setProperty` loop. A single `setTimeout` syncs all signals afterward. This uses the same macrotask scheduling as JSONModel's `bAsyncUpdate` — the browser may render one stale frame before bindings update.

The browser event loop processes work in this order: **current JS > all microtasks > render (paint) > next macrotask**.

The default path gives SignalModel a visual consistency advantage over JSONModel's `bAsyncUpdate`: no stale frames. When `bAsyncUpdate=true` is explicitly requested, SignalModel matches JSONModel's `setTimeout`-based batching — same scheduling, same visual behavior, same performance.

## Development

```bash
npm install
npm run start       # demo app
npm run start:lib   # library dev server
npm run test:qunit  # QUnit tests via WDIO
npm run check       # lint + typecheck
npm run build       # production build
```

## License

MIT
