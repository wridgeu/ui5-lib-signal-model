import ClientModel from "sap/ui/model/ClientModel";
import type Context from "sap/ui/model/Context";
import SignalRegistry from "./SignalRegistry";
import SignalPropertyBinding from "./SignalPropertyBinding";
import SignalListBinding from "./SignalListBinding";
import SignalTreeBinding from "./SignalTreeBinding";
import type { SignalModelOptions, ModelPath, PathValue } from "./types";
import type { Signal } from "signal-polyfill";

// `resolve` exists on Model at runtime but is not in the public @openui5/types stubs
type ClientModelInternal = ClientModel & {
  resolve(sPath: string, oContext?: Context): string | undefined;
  checkUpdate(bForceUpdate?: boolean, bAsync?: boolean): void;
};

function asInternal(self: ClientModel): ClientModelInternal {
  return self as unknown as ClientModelInternal;
}

/**
 * Reactive UI5 model using TC39 Signals for push-based change notification.
 * Drop-in replacement for JSONModel.
 *
 * @namespace ui5.model.signal
 */
export default class SignalModel<T extends object = Record<string, unknown>> extends ClientModel {
  private registry: SignalRegistry;
  private autoCreatePaths: boolean;
  private strictLeafCheck: boolean;
  private _pathSubscribers = new Map<string, Set<() => void>>();
  declare oData: T;

  constructor(sURL: string, mOptions?: SignalModelOptions);
  constructor(oData?: T, mOptions?: SignalModelOptions);
  constructor(oDataOrURL?: T | string, mOptions?: SignalModelOptions) {
    super();
    this.registry = new SignalRegistry();
    this.autoCreatePaths = mOptions?.autoCreatePaths ?? false;
    this.strictLeafCheck = mOptions?.strictLeafCheck ?? false;

    if (typeof oDataOrURL === "string") {
      this.oData = {} as T;
      this.loadData(oDataOrURL);
    } else {
      this.oData = (oDataOrURL || {}) as T;
    }
  }

  /**
   * Load data from a URL. JSONModel-compatible API.
   *
   * Uses `fetch()` internally. Fires `requestSent`, `requestCompleted`,
   * and `requestFailed` events matching the JSONModel contract.
   *
   * @param sURL URL to load JSON from
   * @param oParameters Query parameters (appended to URL for GET, sent as body for POST)
   * @param _bAsync Deprecated — always async. Kept for JSONModel signature compatibility.
   * @param sType HTTP method: "GET" (default) or "POST"
   * @param bMerge Whether to merge loaded data instead of replacing
   * @param bCache Set to false to append a cache-busting timestamp
   * @param mHeaders Additional HTTP headers
   * @returns Promise that resolves when data is loaded
   */
  loadData(
    sURL: string,
    oParameters?: Record<string, string> | string,
    _bAsync?: boolean,
    sType?: string,
    bMerge?: boolean,
    bCache?: boolean,
    mHeaders?: Record<string, string>,
  ): Promise<void> {
    const sMethod = sType || "GET";
    let sFullURL = sURL;

    // Append parameters to URL for GET, matching JSONModel behavior
    if (oParameters && sMethod === "GET") {
      const paramString =
        typeof oParameters === "string" ? oParameters : new URLSearchParams(oParameters).toString();
      sFullURL += (sURL.includes("?") ? "&" : "?") + paramString;
    }

    if (bCache === false) {
      sFullURL += (sFullURL.includes("?") ? "&" : "?") + "_=" + Date.now();
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(sMethod !== "GET" && oParameters && typeof oParameters !== "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...mHeaders,
    };

    this.fireRequestSent({ url: sURL, type: sMethod, async: true });

    const promise = fetch(sFullURL, {
      method: sMethod,
      headers,
      body:
        sMethod !== "GET" && oParameters
          ? typeof oParameters === "string"
            ? oParameters
            : JSON.stringify(oParameters)
          : undefined,
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return res.json();
      })
      .then((data: T) => {
        if (bMerge) {
          this.setData(data as Partial<T>, true);
        } else {
          this.setData(data);
        }
        this.fireRequestCompleted({ url: sURL, type: sMethod, async: true });
      })
      .catch((error: Error) => {
        this.fireRequestFailed({
          message: error.message,
          statusCode: "0",
          statusText: error.message,
        });
        // JSONModel fires requestCompleted on both success and failure
        this.fireRequestCompleted({
          url: sURL,
          type: sMethod,
          async: true,
          success: false,
          errorobject: { message: error.message },
        });
      });

    this._pLoadData = promise;
    return promise;
  }

  /**
   * Returns a Promise that resolves when all pending loadData calls complete.
   * JSONModel-compatible API.
   */
  dataLoaded(): Promise<void> {
    return this._pLoadData ?? Promise.resolve();
  }

  private _pLoadData: Promise<void> | null = null;

  setData(oData: T): void;
  setData(oData: Partial<T>, bMerge: true): void;
  setData(oData: T | Partial<T>, bMerge?: boolean): void {
    if (bMerge) {
      // In-place merge: walk the payload and apply changes directly to this.oData.
      // O(k) where k = payload size, instead of O(n) deep clone of all data.
      this._mergeInPlace(
        this.oData as Record<string, unknown>,
        oData as Record<string, unknown>,
        "",
      );
    } else {
      this.oData = oData as T;
      this.registry.invalidateAll((path: string) => this._getObject(path));
    }
  }

  getData(): T {
    return this.oData;
  }

  getProperty<P extends string & ModelPath<T>>(sPath: P, oContext?: undefined): PathValue<T, P>;
  getProperty(sPath: string, oContext?: object): unknown;
  getProperty(sPath: string, oContext?: object): unknown {
    // Only resolve computed check for proper Context objects (not raw data items from FilterProcessor)
    if (!oContext || typeof (oContext as Context).getPath === "function") {
      const sResolvedPath = asInternal(this).resolve(sPath, oContext as Context | undefined);
      if (sResolvedPath && this.registry.isComputed(sResolvedPath)) {
        return this.registry.get(sResolvedPath)!.get();
      }
    }
    return this._getObject(sPath, oContext);
  }

  setProperty<P extends string & ModelPath<T>>(
    sPath: P,
    oValue: PathValue<T, P>,
    oContext?: undefined,
    bAsyncUpdate?: boolean,
  ): boolean;
  setProperty(sPath: string, oValue: unknown, oContext?: Context, bAsyncUpdate?: boolean): boolean;
  setProperty(sPath: string, oValue: unknown, oContext?: Context, bAsyncUpdate?: boolean): boolean {
    const sResolvedPath = asInternal(this).resolve(sPath, oContext);
    if (!sResolvedPath) {
      return false;
    }

    if (sResolvedPath === "/") {
      this.setData(oValue as T);
      return true;
    }

    if (this.registry.isComputed(sResolvedPath)) {
      throw new TypeError(
        `Cannot set value at "${sResolvedPath}": path is a computed signal (read-only)`,
      );
    }

    const iLastSlash = sResolvedPath.lastIndexOf("/");
    const sObjectPath = sResolvedPath.substring(0, iLastSlash || 1);
    const sPropertyName = sResolvedPath.substring(iLastSlash + 1);

    let oObject = this._getObject(sObjectPath) as Record<string, unknown> | undefined;

    if (!oObject) {
      if (!this.autoCreatePaths) {
        return false;
      }
      oObject = this._createPath(sObjectPath);
    }

    if (oObject) {
      if (this.strictLeafCheck && !(sPropertyName in oObject)) {
        return false;
      }
      oObject[sPropertyName] = oValue;

      if (this.registry.size > 0) {
        if (bAsyncUpdate) {
          // Deferred mode: skip signal notification, schedule a bulk sync.
          // This avoids 2000 synchronous notify callbacks during a batch
          // of setProperty calls — the signals are synced once afterward.
          this._scheduleBulkSync();
        } else {
          this.registry.set(sResolvedPath, oValue);
          this._invalidateParentSignals(sResolvedPath);
          this.registry.invalidateChildren(sResolvedPath, (path: string) => this._getObject(path));
        }
      }

      return true;
    }
    return false;
  }

  private _bulkSyncScheduled = false;

  /**
   * Schedule a single deferred sync of all signals from the data tree.
   *
   * Used by the {@link setProperty} `bAsyncUpdate` path to avoid synchronous
   * signal notifications during a batch of writes. Instead of firing N watcher
   * notify callbacks (one per `setProperty` call), the data is written
   * immediately and a single `setTimeout` syncs all signals afterward.
   * This matches JSONModel's `bAsyncUpdate` batching strategy.
   */
  private _scheduleBulkSync(): void {
    if (!this._bulkSyncScheduled) {
      this._bulkSyncScheduled = true;
      setTimeout(() => {
        this._bulkSyncScheduled = false;
        this.registry.invalidateAll((path: string) => this._getObject(path));
      }, 0);
    }
  }

  mergeProperty<P extends string & ModelPath<T>>(
    sPath: P,
    oValue: Partial<PathValue<T, P>>,
  ): boolean;
  mergeProperty(sPath: string, oValue: unknown, oContext?: Context): boolean;
  mergeProperty(sPath: string, oValue: unknown, oContext?: Context): boolean {
    const sResolvedPath = asInternal(this).resolve(sPath, oContext);
    if (!sResolvedPath) {
      return false;
    }

    // Root path: delegate to setData with merge
    if (sResolvedPath === "/") {
      if (typeof oValue === "object" && oValue !== null) {
        this.setData(oValue as T, true);
        return true;
      }
      return false;
    }

    const existing = this._getObject(sResolvedPath);
    if (existing && typeof existing === "object" && typeof oValue === "object" && oValue !== null) {
      // In-place merge: walk the payload, compare, overwrite, and fire signals in one pass.
      // _mergeInPlace already calls _invalidateParentSignals internally.
      this._mergeInPlace(
        existing as Record<string, unknown>,
        oValue as Record<string, unknown>,
        sResolvedPath,
      );

      return true;
    }

    return this.setProperty(sPath, oValue, oContext);
  }

  override bindProperty(
    sPath: string,
    oContext?: Context,
    mParameters?: object,
  ): SignalPropertyBinding {
    // ClientPropertyBinding's constructor is protected in type stubs but callable from subclasses at runtime
    const binding = new (SignalPropertyBinding as unknown as new (
      model: SignalModel<any>,
      path: string,
      context?: Context,
      params?: object,
    ) => SignalPropertyBinding)(this, sPath, oContext, mParameters);
    binding.subscribe();
    return binding;
  }

  override bindList(
    sPath: string,
    oContext?: Context,
    aSorters?: object | object[],
    aFilters?: object | object[],
    mParameters?: object,
  ): SignalListBinding {
    const binding = new (SignalListBinding as unknown as new (
      model: SignalModel<any>,
      path: string,
      context?: Context,
      sorters?: object | object[],
      filters?: object | object[],
      params?: object,
    ) => SignalListBinding)(this, sPath, oContext, aSorters, aFilters, mParameters);
    binding.subscribe();
    return binding;
  }

  override bindTree(
    sPath: string,
    oContext?: Context,
    aFilters?: object | object[],
    mParameters?: object,
    aSorters?: object | object[],
  ): SignalTreeBinding {
    const binding = new (SignalTreeBinding as unknown as new (
      model: SignalModel<any>,
      path: string,
      context?: Context,
      filters?: object | object[],
      params?: object,
      sorters?: object | object[],
    ) => SignalTreeBinding)(this, sPath, oContext, aFilters, mParameters, aSorters);
    binding.subscribe();
    return binding;
  }

  isList(sPath: string, oContext?: Context): boolean {
    const sAbsolutePath = asInternal(this).resolve(sPath, oContext);
    if (!sAbsolutePath) return false;
    return Array.isArray(this._getObject(sAbsolutePath));
  }

  checkUpdate(_bForceUpdate?: boolean, _bAsync?: boolean): void {
    // Signal-based: bindings self-update via watchers, no polling needed.
  }

  getSignal<P extends string & ModelPath<T>>(
    sPath: P,
  ): Signal.State<PathValue<T, P>> | Signal.Computed<PathValue<T, P>>;
  getSignal(sPath: string): Signal.State<unknown> | Signal.Computed<unknown>;
  getSignal(sPath: string): Signal.State<unknown> | Signal.Computed<unknown> {
    const existing = this.registry.get(sPath);
    if (existing) return existing;
    return this.registry.getOrCreate(sPath, this._getObject(sPath));
  }

  createComputed(
    sPath: string,
    aDeps: string[],
    fn: (...args: unknown[]) => unknown,
  ): Signal.Computed<unknown> {
    // Ensure dependency signals exist before creating the computed.
    // Skip deps that already exist — they may be computed signals from
    // a chained computed, and getOrCreate would shadow them with orphaned state signals.
    for (const dep of aDeps) {
      if (!this.registry.has(dep)) {
        this.registry.getOrCreate(dep, this._getObject(dep));
      }
    }
    const result = this.registry.addComputed(sPath, aDeps, fn);
    // Re-subscribe any bindings that were watching a previous computed at this path.
    // No-op if no bindings exist (Map lookup returns undefined).
    this._firePathResubscribe(sPath);
    return result;
  }

  removeComputed(sPath: string): void {
    this.registry.removeComputed(sPath);
  }

  _getOrCreateSignal(
    sPath: string,
    initialValue: unknown,
  ): Signal.State<unknown> | Signal.Computed<unknown> {
    const existing = this.registry.get(sPath);
    if (existing) return existing;
    return this.registry.getOrCreate(sPath, initialValue);
  }

  _getObject(sPath: string, oContext?: object): unknown {
    // If context is a raw data object (not a Context instance), navigate into it directly.
    // This is needed for FilterProcessor/SorterProcessor which pass raw list items as context.
    if (oContext && typeof (oContext as Context).getPath !== "function") {
      let oNode: unknown = oContext;
      const aParts = sPath.split("/").filter(Boolean);
      for (const sPart of aParts) {
        if (oNode === null || oNode === undefined) return undefined;
        oNode = (oNode as Record<string, unknown>)[sPart];
      }
      return oNode;
    }

    let oNode: unknown = this.oData;

    const sResolvedPath = asInternal(this).resolve(sPath, oContext as Context | undefined);
    if (!sResolvedPath) {
      return undefined;
    }

    if (sResolvedPath === "/") {
      return this.oData;
    }

    const aParts = sResolvedPath.substring(1).split("/");
    for (const sPart of aParts) {
      if (oNode === null || oNode === undefined) {
        return undefined;
      }
      oNode = (oNode as Record<string, unknown>)[sPart];
    }
    return oNode;
  }

  private _createPath(sPath: string): Record<string, unknown> {
    let oNode: Record<string, unknown> = this.oData as Record<string, unknown>;
    const aParts = sPath.substring(1).split("/");

    for (const sPart of aParts) {
      if (sPart === "") continue;
      if (!(sPart in oNode) || oNode[sPart] === null || oNode[sPart] === undefined) {
        oNode[sPart] = {};
      }
      oNode = oNode[sPart] as Record<string, unknown>;
    }
    return oNode;
  }

  private _invalidateParentSignals(sPath: string): void {
    let idx = sPath.lastIndexOf("/");
    while (idx > 0) {
      const parentPath = sPath.substring(0, idx);
      if (this.registry.has(parentPath)) {
        this.registry.set(parentPath, this._getObject(parentPath));
      }
      idx = sPath.lastIndexOf("/", idx - 1);
    }
    // Check root
    if (this.registry.has("/")) {
      this.registry.set("/", this._getObject("/"));
    }
  }

  /**
   * In-place merge + signal notification in a single pass.
   *
   * Walks the payload, compares against existing data, overwrites in-place,
   * and fires signals for changed paths. O(k) where k = payload keys,
   * instead of O(n) deep clone of the entire data tree.
   *
   * Incoming object/array values are cloned via structuredClone to prevent
   * the caller from holding references into the model's internal data.
   */
  private _mergeInPlace(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
    basePath: string,
  ): void {
    for (const key of Object.keys(source)) {
      const childPath = basePath ? `${basePath}/${key}` : `/${key}`;
      const oldValue = target[key];
      const newValue = source[key];

      if (
        typeof oldValue === "object" &&
        oldValue !== null &&
        typeof newValue === "object" &&
        newValue !== null &&
        Array.isArray(oldValue) === Array.isArray(newValue)
      ) {
        // Same container type (both arrays or both plain objects): recurse in-place.
        // Arrays are merged by index, matching deepExtend behavior.
        this._mergeInPlace(
          oldValue as Record<string, unknown>,
          newValue as Record<string, unknown>,
          childPath,
        );
      } else if (oldValue !== newValue) {
        // Clone incoming objects/arrays to prevent external mutation
        target[key] =
          typeof newValue === "object" && newValue !== null ? structuredClone(newValue) : newValue;
        this.registry.set(childPath, target[key]);
        // Type changed: invalidate child signals in either direction
        // (object→primitive: children are gone, primitive→object: children are now valid)
        if (
          (typeof oldValue === "object" && oldValue !== null) ||
          (typeof newValue === "object" && newValue !== null)
        ) {
          this.registry.invalidateChildren(childPath, (path: string) => this._getObject(path));
        }
      }
    }
    // Update the base path signal (the object reference hasn't changed, but contents have)
    const effectivePath = basePath || "/";
    this.registry.set(effectivePath, target);
    if (basePath) {
      this._invalidateParentSignals(basePath);
    }
  }

  _onPathResubscribe(path: string, cb: () => void): void {
    let set = this._pathSubscribers.get(path);
    if (!set) {
      set = new Set();
      this._pathSubscribers.set(path, set);
    }
    set.add(cb);
  }

  _offPathResubscribe(path: string, cb: () => void): void {
    const set = this._pathSubscribers.get(path);
    if (set) {
      set.delete(cb);
      if (set.size === 0) {
        this._pathSubscribers.delete(path);
      }
    }
  }

  private _firePathResubscribe(path: string): void {
    const cbs = this._pathSubscribers.get(path);
    if (cbs) {
      for (const cb of Array.from(cbs)) cb();
    }
  }

  override destroy(): void {
    this._pathSubscribers.clear();
    this.registry.destroy();
    super.destroy();
  }
}
