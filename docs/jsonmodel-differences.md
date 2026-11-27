# Differences from JSONModel

SignalModel is meant as a drop-in replacement for `sap.ui.model.json.JSONModel`. Eight differences remain on purpose. Each is listed here with what to do about it. The Comparison page of the demo app (`npm start`) shows the first five live, next to a JSONModel.

| Difference                                                                                        | Who notices                                                                                                                 |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [A merge works on the data in place](#a-merge-works-on-the-data-in-place)                         | Code that keeps a reference to `getData()` or to an object it passed in, or changes data directly before a merge            |
| [Bindings update in a microtask](#bindings-update-in-a-microtask)                                 | Code that reads a control right after a write, or catches a formatter's error around `setProperty`                          |
| [Change events for objects](#change-events-for-objects)                                           | Change handlers and formatters on a binding to an object or array                                                           |
| [Change events of list bindings around a merge](#change-events-of-list-bindings-around-a-merge)   | List bindings that use the row object itself as change detection key                                                        |
| [Data changed without the model needs `refresh()`](#data-changed-without-the-model-needs-refresh) | Code that changes `getData()` directly and relies on a later write to update the bindings                                   |
| [`loadData` uses `fetch`](#loaddata-uses-fetch)                                                   | Tests and apps that intercept an asynchronous load with `MockServer` or a fake `XMLHttpRequest`, or configure `jQuery.ajax` |
| [A write into a prototype is refused](#a-write-into-a-prototype-is-refused)                       | Nobody on purpose: JSONModel changes `Object.prototype` there                                                               |
| [`observe` covers more](#observe-covers-more)                                                     | Nobody on purpose: JSONModel loses updates or throws there                                                                  |

## How parity is tested

A randomized test runs the same operations against both models and compares them after every step: the data, property, list and tree bindings (including sorted, filtered and suspended ones), computeds, messages, the change events of property and list bindings, and rendered controls. The controls cover expression, composite, typed, two-way, element and aggregation bindings, a second and a named model, a growing and a grouped list, `sap.ui.table.Table`, `sap.ui.table.TreeTable`, `sap.m.Tree` and two instances of an XML view on one model. UI5's own tests of the JSON model and its bindings (194 tests) run against SignalModel as well (`npm run test:ui5`), with the binding updates flushed at once because they assert right after a write. All pass except eleven that mock JSONModel's internals (`jQuery.ajax`, `checkUpdate` of the prototype, the binding's constructor); those are listed in `packages/lib/test/ui5native/expected-failures.json`.

## A merge works on the data in place

After `setData(data, true)` or `mergeProperty` the data equals JSONModel's: same values, same keys in the same order, and keys that hold `undefined` and trailing `undefined` array entries are dropped. JSONModel gets there by building new objects for all data. SignalModel changes the existing ones, which is why a small merge does not depend on the data size. The consequences:

- `getData()` returns the same object as before the merge.
- An object you passed to `setData` or `setProperty` earlier is merged into.
- Data that cannot be changed in place is rebuilt, as JSONModel does with all data: a class instance as root, or a frozen object. `setData(data, true)` finds a frozen object anywhere in the data when it looks for `undefined`; `mergeProperty` rebuilds only when it has to write to one. `getData()` is a new object then, and every binding checks its value, so bindings on objects fire.
- SignalModel looks for `undefined` only when something was written through the model that can hold it (new data, an object, `undefined`, a `length`) or after `refresh()`. JSONModel passes over all data on every merge (about 18 ms for 20,000 rows), SignalModel only when it has to (about 1 ms then, about 30 µs otherwise). `mergeProperty` looks only below its path and cannot clear that state for the whole model, so it passes over the data below its path on each call until a `setData(data, true)` has run. So a key holding `undefined` that you assigned to `getData()` directly survives a merge until `refresh()` is called.

**What to do.** Call `refresh()` after a direct change to `getData()` (see [below](#data-changed-without-the-model-needs-refresh)); the same call covers this. Or write through the model (`setProperty`, `mergeProperty`), or use the `observe` option, which makes an assignment to an existing property count as a write.

```js
model.getData().draft = undefined; // direct change
model.refresh(); // updates the bindings; also lets the next merge drop `draft`
model.setData({ saved: true }, true);
```

## Bindings update in a microtask

JSONModel updates its bindings inside `setProperty`. SignalModel queues them and updates them in a microtask, once for all writes made until then. The data is written at once in both: `getProperty` returns the new value on the next line. What comes one microtask later is everything a binding does: the control's property, a formatter, a change handler.

```js
model.setProperty("/name", "Bob");
model.getProperty("/name"); // "Bob"
text.getText(); // still the old name
await Promise.resolve();
text.getText(); // "Bob"
```

For the same reason an error in a formatter, sorter or filter does not come out of `setProperty`. JSONModel throws it there and skips the remaining bindings; SignalModel logs it and continues with the other bindings.

**What to do.** Read from the model, not from the control, in code that runs right after a write, or wait a microtask. Rendering is asynchronous in both models, so a test that waits for the render pass needs no change. A `try`/`catch` around `setProperty` does not see a formatter's error: catch inside the formatter, sorter or filter, where the error belongs to one binding, and return a fallback value there.

## Change events for objects

A binding on an object or array fires a change event whenever something below it is written through the model. JSONModel fires only when a deep comparison finds a difference, and its binding holds the same object as the model, so it usually finds none. A formatter or expression that reads from a bound object (`{= Object.keys(${/obj}).length }`) therefore shows the new content with SignalModel and can keep the old text with JSONModel.

This is the one difference that is an improvement for most code: what is shown is never stale. Matching JSONModel would mean keeping a deep copy of every bound object and comparing it on every write below, to end up with fewer and sometimes missing updates. What can surprise is a change handler on an object binding that runs more often.

**What to do.** If a handler should run only for one value, bind that value instead of its parent. If it should run only when the content really differs, compare in the handler. A handler that writes below the object it is bound to triggers itself, so write only when the value differs.

```js
import deepEqual from "sap/base/util/deepEqual";
import deepClone from "sap/base/util/deepClone";

const binding = model.bindProperty("/address");
let last = deepClone(binding.getValue());
binding.attachChange(() => {
  const value = binding.getValue();
  if (deepEqual(value, last)) return; // written, but the same content
  last = deepClone(value);
  onAddressChanged(value);
});
```

## Change events of list bindings around a merge

JSONModel's merge replaces every row object. A list binding whose change detection uses the row object itself as key (`enableExtendedChangeDetection(false, "")`) therefore fires after each merge, also when no row changed; with SignalModel it fires after a merge that changed something below it. The list bindings of controls compare the data of their rows and behave the same in both models. After a merge, JSONModel notices the next change in a row because it compares with the rows from before the merge; a SignalModel list binding takes its own copy of the rows at a merge and notices the same changes. A sorted, filtered or grouped list shows the same rows in both. A suspended list binding compares at `resume()` with the rows from before, in both models.

JSONModel's event after a merge that changed nothing is a side effect of rebuilding the data: the binding reports every row as removed and inserted again, and a control with such a binding renders all rows again. SignalModel leaves the rows alone. Firing it here as well would only bring that work back.

**What to do.** If code used that event as a "merge is done" signal, run it after your own `setData(data, true)` call instead, or in the `requestCompleted` handler of a `loadData` with merge. If a control has to rebuild its rows regardless, force it:

```js
model.setData(partial, true);
list.getBinding("items").refresh(true); // fires a change event also when no row changed
```

## Data changed without the model needs `refresh()`

JSONModel checks every binding of the model on every write. A change made directly to `getData()` is therefore picked up by the next `setProperty` or `setData` anywhere in the model, without a `refresh()`. SignalModel tells only the bindings of the written path, the paths above it and the paths below it; that is where its speed comes from. A direct change stays unseen until `refresh()`, or until a write that covers its path.

```js
model.getData().items.push(newItem); // direct change
model.setProperty("/busy", false);
// JSONModel: the list shows the new item. SignalModel: it does not.
```

A binding's own `refresh()` does the same for its path and the paths below it. That binding checks its value at once, as in JSONModel, and does nothing while it is suspended. Other bindings on those paths update in the next microtask; in JSONModel they wait for the next write. A computed whose dependencies were changed directly needs `model.refresh()`.

**What to do.** Write through the model (`setProperty("/items", [...items, newItem])`), or call `model.refresh()` after the direct change. With the `observe` option an assignment to an existing property counts as a write; a `push` or a new key does not, as in JSONModel.

```js
model.getData().items.push(newItem);
model.refresh(); // both models: every binding checks
```

## `loadData` uses `fetch`

JSONModel loads with `jQuery.ajax`. SignalModel loads asynchronously with `fetch` and synchronously (`loadData(url, params, false)`) with `XMLHttpRequest`. The parameters, events, error objects and log entries are the same. What differs is what can intercept an asynchronous request:

- `sap.ui.core.util.MockServer` and sinon's fake `XMLHttpRequest` do not see it. They do see a synchronous load.
- The `X-Requested-With: XMLHttpRequest` header is not sent, and `Accept` is `application/json` unless you pass your own.

For both kinds of load, `jQuery.ajaxSetup`, prefilters and global ajax events do not apply.

**What to do.** In a test with `MockServer` or a fake `XMLHttpRequest`, load synchronously, or stub `window.fetch`, or serve the file. In an app, mock at the network level (a service worker or the dev server), or load the data yourself and pass it to `setData`. Send headers you need with the `headers` parameter of `loadData`.

## A write into a prototype is refused

JSONModel follows a path wherever it leads. `setProperty("/__proto__/isAdmin", true)` or `setProperty("/constructor/prototype/isAdmin", true)` therefore writes to `Object.prototype`, and every object in the page has the property afterwards. A path built from user input or from a backend key is enough for that.

SignalModel refuses such a write: `setProperty` and `mergeProperty` return `false` and log a warning when the path has a `__proto__` segment, or goes on through a `constructor` that the data only inherits. A key named `constructor` that the data holds itself is data and stays writable. Reading is unchanged.

**What to do.** Nothing, unless code relied on reaching a prototype through the model; change the prototype directly then.

## `observe` covers more

With the `observe` option (JSONModel's `bObserve`) both models put getters and setters on the data. JSONModel has four gaps there that SignalModel does not copy:

- A key created by `setProperty` is observed, and so is everything below it. JSONModel observes only what `setData` saw, so a later assignment to such a property updates nothing.
- A hole in an array stays visible after it was filled. In JSONModel the index is hidden from `Object.keys` from then on, and a merge into that array throws.
- Data that refers to itself is observed. JSONModel ends in a stack overflow.
- A frozen or sealed object in the data is left as it is; it takes no change that would need observing. JSONModel throws a `TypeError`.

A key added by a direct assignment and a `push` are not observed in either model; call `refresh()` after those.
