# Differences from JSONModel

SignalModel is meant as a drop-in replacement for `sap.ui.model.json.JSONModel`. Four differences remain on purpose. Each is listed here with what to do about it. The Comparison page of the demo app (`npm start`) shows the object binding and the direct change live, next to a JSONModel.

| Difference                                                                                      | Who notices                                                                                                      |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [A merge works on the data in place](#a-merge-works-on-the-data-in-place)                       | Code that keeps a reference to `getData()` or to an object it passed in, or changes data directly before a merge |
| [Errors while bindings update](#errors-while-bindings-update)                                   | Code that catches a formatter's error around `setProperty`                                                       |
| [Change events for objects](#change-events-for-objects)                                         | Change handlers and formatters on a binding to an object or array                                                |
| [Change events of list bindings around a merge](#change-events-of-list-bindings-around-a-merge) | List bindings that use the row object itself as change detection key                                             |

## How parity is tested

A randomized test runs the same operations against both models and compares them after every step: the data, property, list and tree bindings (including sorted, filtered and suspended ones), computeds, messages, the change events of property and list bindings, and rendered controls. The controls cover expression, composite, typed, two-way, element and aggregation bindings, a second and a named model, a growing and a grouped list, `sap.ui.table.Table`, `sap.ui.table.TreeTable`, `sap.m.Tree` and two instances of an XML view on one model. UI5's own tests of the JSON model and its bindings (194 tests) run against SignalModel as well (`npm run test:ui5`), with the binding updates flushed at once because they assert right after a write. All pass except eleven that mock JSONModel's internals (`jQuery.ajax`, `checkUpdate` of the prototype, the binding's constructor); those are listed in `test/ui5native/expected-failures.json`.

## A merge works on the data in place

After `setData(data, true)` or `mergeProperty` the data equals JSONModel's: same values, same keys in the same order, and keys that hold `undefined` and trailing `undefined` array entries are dropped. JSONModel gets there by building new objects for all data. SignalModel changes the existing ones, which is why a small merge does not depend on the data size. The consequences:

- `getData()` returns the same object as before the merge.
- An object you passed to `setData` or `setProperty` earlier is merged into.
- Data whose root is frozen or a class instance is rebuilt, as in JSONModel. A frozen object deeper in otherwise unfrozen data makes a merge throw.
- SignalModel looks for `undefined` only when something was written through the model that can hold it (new data, an object, `undefined`) or after `refresh()`. JSONModel passes over all data on every merge (about 18 ms for 20,000 rows), SignalModel only when it has to (about 1 ms then, about 40 µs otherwise). So a key holding `undefined` that you assigned to `getData()` directly survives a merge until `refresh()` is called.

**What to do.** Nothing new. After a direct change to `getData()` you call `refresh()` in JSONModel too, or its bindings stay stale; the same call covers this. Or write through the model (`setProperty`, `mergeProperty`), or use the `observe` option, which makes an assignment to an existing property count as a write. If a later merge has to work on frozen nested data, pass a copy when you set it (`setData(structuredClone(data))`).

```js
model.getData().draft = undefined; // direct change
model.refresh(); // needed for the bindings in both models; also lets the next merge drop `draft`
model.setData({ saved: true }, true);
```

## Errors while bindings update

If a formatter, sorter or filter throws during an update, JSONModel throws the error out of `setProperty` and skips the remaining bindings. SignalModel updates bindings in a microtask: it logs the error and continues with the other bindings.

**What to do.** A `try`/`catch` around `setProperty` does not see such an error. Catch inside the formatter, sorter or filter, where the error belongs to one binding, and return a fallback value there.

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
