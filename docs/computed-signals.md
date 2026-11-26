# Computed Signals: Re-Evaluation and Notifications

Background to the [computed signals](../packages/lib/README.md#computed-signals) of SignalModel: what is notified when a computed re-evaluates, why a computed is one unit, and how to keep its dependencies narrow.

When a computed re-evaluates, **all** bindings that resolve through it are notified, including sub-path bindings. Each notified binding compares its old value to its new value (`checkUpdate`), and only bindings whose value actually changed trigger a DOM update.

```typescript
model.createComputed("/computedRows", ["/sourceRows"], (rows) =>
  rows.map((r) => ({ ...r, display: `${r.name} ($${r.price})` })),
);

// Grid table bound to /computedRows, each cell bound to {name}, {price}, etc.
// When /sourceRows is replaced (setProperty("/sourceRows", newArray)):
// 1. The computed re-evaluates → returns a new array
// 2. ALL cell bindings are notified (they resolve through the computed)
// 3. Each cell runs checkUpdate -- compares old vs new value
// 4. Only cells whose value actually changed trigger a DOM update
```

**Rendering is correct** -- unchanged cells do not re-render. But every binding performs the comparison check. For a grid table with 2000 rows and 3 columns, 6000 bindings are checked even if only 1 value changed. This is the expected behavior, not a limitation.

## Why Computed Signals Are Atomic

The [TC39 Signals proposal](https://github.com/tc39/proposal-signals) explicitly defines `Signal.Computed` as a single, atomic reactive node. A computed produces one value, compares it as a whole via `Object.is`, and notifies all downstream consumers uniformly. There is no concept of sub-path or partial notification in the specification.

This is a deliberate design choice shared across the signals ecosystem:

- **SolidJS** separates [`createSignal`](https://docs.solidjs.com/reference/basic-reactivity/create-signal) (atomic, single value) from [`createStore`](https://docs.solidjs.com/concepts/stores) (Proxy-based, fine-grained per-property tracking). These are two distinct primitives -- stores are not "better signals," they are a fundamentally different reactive architecture built on top of `Proxy`.
- **Angular Signals** are fully atomic. There is no built-in store primitive. The recommended approach for reducing notifications is to decompose large objects into smaller, focused signals.
- **Preact Signals** are atomic. The community-built [`deepsignal`](https://github.com/luisherranz/deepsignal) package adds Proxy-based fine-grained tracking as an opt-in layer on top.

SignalModel follows the TC39 model: a `Signal.Computed` is a single reactive node, and all observers are notified when it changes.

## Signals vs Proxy-Based Reactivity

MobX and Vue use a fundamentally different architecture. They wrap objects in JavaScript `Proxy` instances that intercept every property `get` and `set`. When a computed getter reads `state.items[3].name`, the Proxy's `get` trap records that specific property access, creating a per-property dependency. When `state.items[3].name` changes, only the computations that read that exact property are notified.

| Aspect                     | TC39 Signals (SignalModel, SolidJS signals, Angular) | Proxy-based (MobX, Vue `reactive()`, SolidJS stores) |
| -------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| **Unit of tracking**       | The entire signal value                              | Individual properties on an object                   |
| **Dependency granularity** | "I depend on signal X"                               | "I depend on property `a` of object X"               |
| **Notification**           | All subscribers of signal X                          | Only subscribers of `X.a`                            |
| **Mechanism**              | Value comparison via `equals`                        | Proxy `get`/`set` traps                              |

The Proxy-based approach is more fine-grained by default but comes with trade-offs: Proxy objects have identity issues (the proxy is not the original object), they add overhead on every property access, and they cannot be serialized directly. The TC39 proposal intentionally chose the atomic model as the primitive because it is simpler, composable, and avoids forcing Proxy overhead on all signal usage. Fine-grained tracking can always be layered on top, but you cannot remove Proxy overhead from a system that requires it.

## Notification Cost

When a computed re-evaluates, the notification cost is O(N) where N is the number of bindings that resolve through the computed:

1. Each binding's `Signal.subtle.Watcher` callback fires (TC39 mechanism, cannot be intercepted)
2. Each binding is scheduled in the shared flush queue
3. Each binding's `checkUpdate` re-reads its value and compares with the previous value
4. Only bindings whose value actually changed trigger a DOM update (O(k) where k ≤ N)

For primitive leaf values (strings, numbers -- typical for table cells), the comparison is `Object.is`, which is effectively free and handles `NaN` accurately. For direct property bindings, the flush queue passes the already-read signal value directly to `checkUpdate`, avoiding redundant path traversal.

## Dependency Granularity

A computed that depends on a parent path (e.g., `/sourceRows`) re-evaluates both when that path is replaced (`setProperty("/sourceRows", newArray)`) **and** when a child path is updated via `setProperty("/sourceRows/3/name", "new")`, because ancestor state signals are invalidated and both state and computed signals use `signalEquals` (which always notifies for non-null objects). If you want narrower invalidation for large arrays, split dependencies onto specific paths or bind directly to leaf paths.

```typescript
// Re-evaluates when /sourceRows is replaced OR a child path is updated via setProperty:
model.createComputed("/computed", ["/sourceRows"], (rows) => transform(rows));

model.setProperty("/sourceRows/3/name", "updated"); // invalidates /sourceRows -> computed re-evaluates
model.setProperty("/sourceRows", [...newArray]); // invalidates /sourceRows -> computed re-evaluates
```

```typescript
model.setProperty("/currentUser/name", "Bob"); // returns false -- computed path is read-only
```

To update the data, write to the **source** path. The computed re-derives automatically and all sub-path bindings update:

```typescript
model.setProperty("/users/0/name", "Bob"); // writes to source data -- /currentUser/name updates
```
