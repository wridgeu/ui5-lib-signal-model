import ClientListBinding from "sap/ui/model/ClientListBinding";
import ChangeReason from "sap/ui/model/ChangeReason";
import type Context from "sap/ui/model/Context";
import deepEqual from "sap/base/util/deepEqual";
import deepExtend from "sap/base/util/deepExtend";
import extend from "sap/base/util/extend";
import { Signal } from "signal-polyfill";
import type SignalModel from "./SignalModel";
import { scheduleFlush, cancelFlush, teardownWatcher } from "./FlushQueue";

// Runtime properties/methods not exposed by @openui5/types.
// getResolvedPath, isRelative are on the public API and don't need casting.
type ListBindingInternal = ClientListBinding & {
  oList: unknown[] | Record<string, unknown>;
  aIndices: (number | string)[];
  iLength: number;
  bUseExtendedChangeDetection: boolean;
  bDetectUpdates: boolean;
  aLastContexts: Context[] | undefined;
  aLastContextData: unknown[] | undefined;
  iLastStartIndex: number | undefined;
  iLastLength: number | undefined;
  sPath: string;
  oContext: Context | undefined;
  bSuspended: boolean;
  bIgnoreSuspend: boolean;
  updateIndices(): void;
  applyFilter(): void;
  applySort(): void;
  _getLength(): number;
  _getContexts(startIndex?: number, length?: number): Context[];
  getContextData(context: Context): string;
  _fireChange(params: { reason: string }): void;
};

/**
 * Casts to an internal type that includes UI5 runtime properties not exposed
 * by `@openui5/types` (e.g. `oList`, `bSuspended`, `_fireChange`).
 */
function asInternal(self: SignalListBinding): ListBindingInternal {
  return self as unknown as ListBindingInternal;
}

/**
 * List binding that subscribes to a signal for push-based change notification.
 * Reuses ClientListBinding's filter/sort/extended-change-detection.
 *
 * @namespace ui5.model.signal
 * @since 0.1.0
 */
export default class SignalListBinding extends ClientListBinding {
  declare oModel: SignalModel;
  watcher: Signal.subtle.Watcher | null = null;
  private _subscribedPath: string | null = null;
  /** The subscribed path with a trailing slash: what the paths below this list start with */
  private _below = "";
  /**
   * A merge reached this list since the last update(). JSONModel then compares with the
   * rows from before the merge, so it notices the next change in a row.
   */
  private _merged = false;
  /**
   * A merge changed a value below this list. Set by SignalModel.
   *
   * @internal
   */
  _rowChanged = false;
  /** Like _merged, but only until the bindings were updated after the merge */
  private _mergedNow = false;
  /** The rows are a copy of the model's (see _copyRows), taken since the last update() */
  private _ownRows = false;
  /** The rows as they were before _onRowChange() copied them in the merge that is running */
  private _sharedRows?: unknown[] | Record<string, unknown>;

  /**
   * A merge at `path` took place. JSONModel's merge rebuilds the merged data, so the row
   * objects a list binding holds are no longer the model's, and it notices the next change
   * in a row. Here rows are merged in place, so the binding has to be told.
   * Used by SignalModel, not part of the public API.
   *
   * @internal
   */
  _onMerge(path: string): void {
    const own = this._subscribedPath;
    if (!own) return;
    const below = this._below;
    const reached =
      path === "/" ||
      path === own ||
      own.startsWith(`${path}/`) ||
      // a row itself
      (path.startsWith(below) && !path.includes("/", below.length));
    const internal = asInternal(this);
    const shared = this._sharedRows;
    this._sharedRows = undefined;
    if (!reached) {
      // A change the merge made below a row counts only with a merge that reaches the list
      if (!this._merged) this._rowChanged = false;
      if (shared) {
        internal.oList = shared;
        this._ownRows = false;
      }
      return;
    }
    if (!internal.bUseExtendedChangeDetection && !this._merged && !this._rowChanged) {
      this._copyRows();
    }
    this._merged = true;
    this._mergedNow = true;
    // Until the bindings were updated after the merge. Two hops, so that an update queued
    // later in this task still runs first. A suspended list is checked at resume().
    if (!internal.bSuspended) {
      queueMicrotask(() =>
        queueMicrotask(() => {
          this._mergedNow = false;
        }),
      );
    }
  }

  /**
   * The list shares its rows with the model, so its comparison is blind to a change in a
   * row. JSONModel's list is left with the rows from before the merge: give this one its
   * own rows too. They stay until the next update(), also over further merges.
   */
  private _copyRows(): void {
    if (this._ownRows) return;
    const internal = asInternal(this);
    internal.oList = deepExtend(Array.isArray(internal.oList) ? [] : {}, internal.oList) as
      | unknown[]
      | Record<string, unknown>;
    this._ownRows = true;
  }

  /**
   * A merge is about to change a value below this list. Used by SignalModel, not part of
   * the public API.
   *
   * @internal
   */
  _onRowChange(): void {
    const internal = asInternal(this);
    if (internal.bSuspended && !internal.bUseExtendedChangeDetection) {
      // Compared at resume() only, and as in JSONModel with the rows from before: a change
      // that a later merge takes back is none
      if (!this._ownRows) this._sharedRows = internal.oList;
      this._copyRows();
    } else {
      this._rowChanged = true;
    }
  }

  /**
   * Whether `path` is below this list. Used by SignalModel, not part of the public API.
   *
   * @internal
   */
  _isAbove(path: string): boolean {
    return path.startsWith(this._below);
  }

  /** @since 0.1.0 */
  update(): void {
    const internal = asInternal(this);
    this._merged = this._rowChanged = this._ownRows = false;
    this._sharedRows = undefined;
    const list = this.oModel._getObject(internal.sPath, internal.oContext);
    if (list) {
      // Copied with the functions JSONListBinding uses
      if (Array.isArray(list)) {
        internal.oList = internal.bUseExtendedChangeDetection
          ? (deepExtend([], list) as unknown[])
          : list.slice();
      } else {
        internal.oList = (internal.bUseExtendedChangeDetection ? deepExtend : extend)(
          {},
          list,
        ) as Record<string, unknown>;
      }
      this.updateIndices();
      internal.applyFilter();
      internal.applySort();
      internal.iLength = internal._getLength();
    } else {
      internal.oList = [];
      internal.aIndices = [];
      internal.iLength = 0;
    }
  }

  /**
   * Override ClientListBinding.updateIndices to handle both arrays and objects.
   * ClientListBinding only handles arrays (numeric indices). JSONListBinding
   * overrides this to also handle objects (string keys via for...in).
   *
   * @since 0.1.0
   */
  updateIndices(): void {
    const internal = asInternal(this);
    internal.aIndices = [];
    if (Array.isArray(internal.oList)) {
      for (let i = 0; i < internal.oList.length; i++) {
        internal.aIndices.push(i);
      }
    } else {
      for (const key in internal.oList) {
        internal.aIndices.push(key);
      }
    }
  }

  /**
   * @param forceUpdate - Whether to force a change event regardless of suspension state.
   * @since 0.1.0
   */
  checkUpdate(forceUpdate?: boolean): void {
    const internal = asInternal(this);
    if (internal.bSuspended && !internal.bIgnoreSuspend && !forceUpdate) {
      return;
    }

    const list = (this.oModel._getObject(internal.sPath, internal.oContext) || []) as
      | unknown[]
      | Record<string, unknown>;

    if (!internal.bUseExtendedChangeDetection) {
      // A merge that changed a row did so in place, where the comparison cannot see it
      if (!deepEqual(internal.oList, list) || (this._merged && this._rowChanged) || forceUpdate) {
        this.update();
        internal._fireChange({ reason: ChangeReason.Change });
      }
      return;
    }

    let changeDetected = (internal.oList as unknown[]).length !== (list as unknown[]).length;
    if (!deepEqual(internal.oList, list)) {
      // Where the key of a row is the row object itself, JSONModel compares the objects, and
      // its merge replaces them
      changeDetected ||=
        this._mergedNow &&
        !internal.bDetectUpdates &&
        !!internal.aLastContextData?.some((key) => typeof key === "object" && key !== null);
      this.update();
    }

    this._mergedNow = false;

    const contexts = internal._getContexts(internal.iLastStartIndex, internal.iLastLength);
    if (internal.aLastContexts) {
      if (internal.aLastContexts.length !== contexts.length) {
        changeDetected = true;
      } else if (internal.aLastContextData) {
        for (let i = 0; i < internal.aLastContextData.length; i++) {
          if (internal.getContextData(contexts[i]) !== internal.aLastContextData[i]) {
            changeDetected = true;
            break;
          }
        }
      }
    } else {
      changeDetected = true;
    }

    if (changeDetected || forceUpdate) {
      internal._fireChange({ reason: ChangeReason.Change });
    }
  }

  /**
   * Checks the binding against the data, as in JSONModel. The data may have changed without
   * the model, so the signals at the binding's path and below it are brought in line first;
   * otherwise a later write of the value they still hold would be no change.
   *
   * @param forceUpdate - Whether to fire a change event regardless of value comparison.
   */
  override refresh(forceUpdate?: boolean): void {
    // As JSONModel: a suspended binding does nothing unless forced
    if (this.isSuspended() && !forceUpdate) return;
    if (this._subscribedPath) {
      this.oModel._syncSignals(this._subscribedPath);
      // The check below covers this binding: a queued update would be a second event
      cancelFlush(this);
      this.watcher?.watch();
    }
    super.refresh(forceUpdate);
  }

  /** @since 0.1.0 */
  subscribe(): void {
    this.unsubscribe();

    const resolvedPath = this.getResolvedPath();
    if (!resolvedPath) return;

    const signal = this.oModel._getSignal(resolvedPath);

    // The model tells the bindings on a state signal itself; only a computed needs a watcher
    if (!(signal instanceof Signal.State)) {
      this.watcher = new Signal.subtle.Watcher(() => {
        scheduleFlush(this, signal);
      });
      this.watcher.watch(signal);
    }

    this._subscribedPath = resolvedPath;
    this._below = resolvedPath === "/" ? "/" : `${resolvedPath}/`;
    this.oModel._listBindings.add(this);
    this.oModel._subscribe(resolvedPath, this);
  }

  /** @since 0.1.0 */
  unsubscribe(): void {
    if (this._subscribedPath) {
      this.oModel._unsubscribe(this._subscribedPath, this);
      this._subscribedPath = null;
      this._below = "";
    }
    this.oModel._listBindings.delete(this);
    cancelFlush(this);
    this.watcher = teardownWatcher(this.watcher);
  }

  /**
   * @returns The binding instance for chaining.
   * @since 0.1.0
   */
  override initialize(): this {
    this.update();
    if (!this._subscribedPath) {
      this.subscribe();
    }
    // Fire initial change so controls (e.g. sap.m.List) populate their aggregation; not
    // while suspended, as Binding.initialize
    const internal = asInternal(this);
    if (!internal.bSuspended) internal._fireChange({ reason: ChangeReason.Change });
    return this;
  }

  /**
   * @param context - The new binding context.
   * @since 0.1.0
   */
  setContext(context?: object): void {
    const internal = asInternal(this);
    if (internal.oContext != context) {
      internal.oContext = context as Context;
      if (this.isRelative()) {
        this.update();
        this.subscribe();
        internal._fireChange({ reason: ChangeReason.Context });
      }
    }
  }

  /** @since 0.1.0 */
  override destroy(): void {
    this.unsubscribe();
    super.destroy();
  }
}
