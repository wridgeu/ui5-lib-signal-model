# Differences from JSONModel

SignalModel is meant as a drop-in replacement for `sap.ui.model.json.JSONModel`. Four differences remain on purpose. Each is listed here with what to do about it. The Comparison page of the demo app (`npm start`) shows all four live, next to a JSONModel.

| Difference                                                                                      | Who notices                                                                                                      |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [A merge works on the data in place](#a-merge-works-on-the-data-in-place)                       | Code that keeps a reference to `getData()` or to an object it passed in, or changes data directly before a merge |
| [Bindings update in a microtask](#bindings-update-in-a-microtask)                               | Code that reads a control right after a write, or catches a formatter's error around `setProperty`               |
| [Change events for objects](#change-events-for-objects)                                         | Change handlers and formatters on a binding to an object or array                                                |
| [Change events of list bindings around a merge](#change-events-of-list-bindings-around-a-merge) | List bindings that use the row object itself as change detection key                                             |

## How parity is tested

A randomized test runs the same operations against both models and compares them after every step: the data, property, list and tree bindings (including sorted, filtered and suspended ones), computeds, messages, the change events of property and list bindings, and rendered controls. The controls cover expression, composite, typed, two-way, element and aggregation bindings, a second and a named model, a growing and a grouped list, `sap.ui.table.Table`, `sap.ui.table.TreeTable`, `sap.m.Tree` and two instances of an XML view on one model. UI5's own tests of the JSON model and its bindings (194 tests) run against SignalModel as well (`npm run test:ui5`), with the binding updates flushed at once because they assert right after a write. All pass except eleven that mock JSONModel's internals (`jQuery.ajax`, `checkUpdate` of the prototype, the binding's constructor); those are listed in `packages/lib/test/ui5native/expected-failures.json`.

## A merge works on the data in place

After `setData(data, true)` or `mergeProperty` the data equals JSONModel's: same values, same keys in the same order, and keys that hold `undefined` and trailing `undefined` array entries are dropped. JSONModel gets there by building new objects for all data. SignalModel changes the existing ones, which is why a small merge does not depend on the data size. The consequences:

- `getData()` returns the same object as before the merge.
- An object you passed to `setData` or `setProperty` earlier is merged into.
- Data that cannot be changed in place is rebuilt, as JSONModel does with all data: a class instance as root, or a frozen object anywhere in the data (found when the merge looks for `undefined`, or when it has to write to it). `getData()` is a new object then, and every binding checks its value, so bindings on objects fire.
- SignalModel looks for `undefined` only when something was written through the model that can hold it (new data, an object, `undefined`) or after `refresh()`. JSONModel passes over all data on every merge (about 18 ms for 20,000 rows), SignalModel only when it has to (about 1 ms then, about 30 µs otherwise). So a key holding `undefined` that you assigned to `getData()` directly survives a merge until `refresh()` is called.

**What to do.** Nothing new. After a direct change to `getData()` you call `refresh()` in JSONModel too, or its bindings stay stale; the same call covers this. Or write through the model (`setProperty`, `mergeProperty`), or use the `observe` option, which makes an assignment to an existing property count as a write.

```js
model.getData().draft = undefined; // direct change
model.refresh(); // needed for the bindings in both models; also lets the next merge drop `draft`
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
