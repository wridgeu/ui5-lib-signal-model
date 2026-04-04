import ClientModel from "sap/ui/model/ClientModel";
import Log from "sap/base/Log";
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
  checkUpdate(bForceUpdate?: boolean, bAsync?: boolean): number;
  bDestroyed: boolean;
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
  private _pImportChain: Promise<void> = Promise.resolve();
  private _abortController: AbortController | null = new AbortController();
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
   * Calls are chained sequentially — multiple `loadData` calls execute
   * in order, matching JSONModel's `pSequentialImportCompleted` behavior.
   *
   * @param sURL URL to load JSON from
   * @param oParameters Query parameters (appended to URL for GET, sent as body for POST)
   * @param _bAsync Deprecated — always async. Kept for JSONModel signature compatibility.
   * @param sType HTTP method: "GET" (default) or "POST"
   * @param bMerge Whether to merge loaded data instead of replacing
   * @param bCache Set to false to append a cache-busting timestamp
   * @param mHeaders Additional HTTP headers
   * @param oSignal AbortSignal to cancel the request (SignalModel extension)
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
    oSignal?: AbortSignal,
  ): Promise<void> {
    if (asInternal(this).bDestroyed) {
      return Promise.resolve();
    }
    const sMethod = sType || "GET";
    let sFullURL = sURL;
    const sInfo = "cache=" + bCache + ";bMerge=" + bMerge;
    const oInfoObject = { cache: bCache, merge: bMerge };

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

    this.fireRequestSent({
      url: sURL,
      type: sMethod,
      async: true,
      info: sInfo,
      infoObject: oInfoObject,
    });

    // Combine the model's internal abort signal with any user-provided signal.
    // AbortSignal.any() fires when either signal aborts — on destroy() or caller abort.
    const signals = [this._abortController!.signal, oSignal].filter(Boolean) as AbortSignal[];
    const combinedSignal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

    const pImport = fetch(sFullURL, {
      method: sMethod,
      headers,
      signal: combinedSignal,
      body:
        sMethod !== "GET" && oParameters
          ? typeof oParameters === "string"
            ? oParameters
            : JSON.stringify(oParameters)
          : undefined,
    }).then(async (res) => {
      if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status}: ${res.statusText}`), {
          statusCode: res.status,
          statusText: res.statusText,
          responseText: await res.text().catch(() => ""),
        });
      }
      return res.json() as Promise<T>;
    });

    // Chain sequentially: wait for previous imports, then process this one.
    // Matches JSONModel's pSequentialImportCompleted pattern.
    const pReturn = this._pImportChain.then(() =>
      pImport.then(
        (data: T) => {
          if (bMerge) {
            this.setData(data as Partial<T>, true);
          } else {
            this.setData(data);
          }
          this.fireRequestCompleted({
            url: sURL,
            type: sMethod,
            async: true,
            info: sInfo,
            infoObject: oInfoObject,
            success: true,
          });
        },
        (error: Error & { statusCode?: number; statusText?: string; responseText?: string }) => {
          const oError = {
            message: error.message,
            statusCode: String(error.statusCode ?? 0),
            statusText: error.statusText ?? error.message,
            responseText: error.responseText ?? "",
          };
          this.fireRequestCompleted({
            url: sURL,
            type: sMethod,
            async: true,
            info: sInfo,
            infoObject: oInfoObject,
            success: false,
            errorobject: oError,
          });
          this.fireRequestFailed(oError);
        },
      ),
    );

    this._pImportChain = pReturn.catch(() => {
      // Swallow errors so the chain stays alive for subsequent calls
    });

    return pReturn;
  }

  /**
   * Returns a Promise that resolves when all pending loadData calls complete.
   * Calls queued after this point are not included.
   * JSONModel-compatible API.
   */
  dataLoaded(): Promise<void> {
    return this._pImportChain;
  }

  /**
   * Serialize model data as a JSON string. JSONModel-compatible API.
   */
  getJSON(): string {
    return JSON.stringify(this.oData);
  }

  /**
   * Parse a JSON string and set it as model data. JSONModel-compatible API.
   *
   * @param sJSON JSON string to parse
   * @param bMerge Whether to merge into existing data instead of replacing
   */
  setJSON(sJSON: string, bMerge?: boolean): void {
    try {
      const oData = JSON.parse(sJSON) as T;
      if (bMerge) {
        this.setData(oData as Partial<T>, true);
      } else {
        this.setData(oData);
      }
    } catch (e) {
      Log.fatal(
        "The following problem occurred: JSON parse Error: " + e,
        undefined,
        "ui5.model.signal.SignalModel",
      );
    }
  }

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

    const sComputedAncestor = this._findComputedAncestor(sResolvedPath);
    if (sComputedAncestor) {
      Log.warning(
        `Cannot set value at "${sResolvedPath}": ` +
          (sComputedAncestor === sResolvedPath
            ? "path is a computed signal (read-only)"
            : `ancestor "${sComputedAncestor}" is a computed signal (read-only)`),
        undefined,
        "ui5.model.signal.SignalModel",
      );
      return false;
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

    const sComputedAncestor = this._findComputedAncestor(sResolvedPath);
    if (sComputedAncestor) {
      Log.warning(
        `Cannot merge value at "${sResolvedPath}": ` +
          (sComputedAncestor === sResolvedPath
            ? "path is a computed signal (read-only)"
            : `ancestor "${sComputedAncestor}" is a computed signal (read-only)`),
        undefined,
        "ui5.model.signal.SignalModel",
      );
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

  checkUpdate(bForceUpdate?: boolean, bAsync?: boolean): void {
    // Signal-based bindings self-update via watchers, so routine polling
    // (bForceUpdate=false) is unnecessary. However, the framework calls
    // checkUpdate(true) during context propagation (e.g. setBindingContext)
    // — delegate to Model.prototype.checkUpdate so bindings re-evaluate.
    if (bForceUpdate) {
      (ClientModel.prototype as unknown as ClientModelInternal).checkUpdate.call(
        this,
        bForceUpdate,
        bAsync,
      );
    }
  }

  getSignal<P extends string & ModelPath<T>>(
    sPath: P,
  ): Signal.State<PathValue<T, P>> | Signal.Computed<PathValue<T, P>>;
  getSignal(sPath: string): Signal.State<unknown> | Signal.Computed<unknown>;
  getSignal(sPath: string): Signal.State<unknown> | Signal.Computed<unknown> {
    const existing = this.registry.get(sPath);
    if (existing) return existing;

    // If a parent path is a computed signal, subscribe to it instead.
    // Search bottom-up (closest ancestor first) so bindings track the
    // most specific computed. Uses lastIndexOf to avoid array allocation.
    if (this.registry.hasComputeds) {
      let idx = sPath.lastIndexOf("/");
      while (idx > 0) {
        const sParentPath = sPath.substring(0, idx);
        if (this.registry.isComputed(sParentPath)) {
          return this.registry.get(sParentPath)!;
        }
        idx = sPath.lastIndexOf("/", idx - 1);
      }
    }

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

  _getObject(sPath: string, oContext?: object): unknown {
    // If context is a raw data object (not a Context instance), navigate into it directly.
    // This is needed for FilterProcessor/SorterProcessor which pass raw list items as context.
    if (oContext && typeof (oContext as Context).getPath !== "function") {
      let oNode: unknown = oContext;
      // Walk the path without allocating arrays. This branch is called
      // per-row during FilterProcessor/SorterProcessor operations.
      let start = 0;
      while (start < sPath.length) {
        if (sPath[start] === "/") {
          start++;
          continue;
        }
        const end = sPath.indexOf("/", start);
        const sPart = end === -1 ? sPath.substring(start) : sPath.substring(start, end);
        if (oNode === null || oNode === undefined) return undefined;
        oNode = (oNode as Record<string, unknown>)[sPart];
        start = end === -1 ? sPath.length : end + 1;
      }
      return oNode;
    }

    let oNode: unknown = this.oData;

    const sResolvedPath = asInternal(this).resolve(sPath, oContext as Context | undefined);
    if (!sResolvedPath) {
      return null;
    }

    // Computed signals live in the registry, not in oData.
    // Return the computed value so list/tree bindings can see it.
    if (this.registry.isComputed(sResolvedPath)) {
      return this.registry.get(sResolvedPath)!.get();
    }

    if (sResolvedPath === "/") {
      return this.oData;
    }

    const aParts = sResolvedPath.substring(1).split("/");
    if (this.registry.hasComputeds) {
      let sCurrentPath = "";
      for (const sPart of aParts) {
        if (!sPart) break;
        sCurrentPath += "/" + sPart;

        if (this.registry.isComputed(sCurrentPath)) {
          oNode = this.registry.get(sCurrentPath)!.get();
          continue;
        }

        if (oNode === null || oNode === undefined) {
          return oNode;
        }
        oNode = (oNode as Record<string, unknown>)[sPart];
      }
    } else {
      for (const sPart of aParts) {
        if (!sPart) break;
        if (oNode === null || oNode === undefined) {
          return oNode;
        }
        oNode = (oNode as Record<string, unknown>)[sPart];
      }
    }
    return oNode;
  }

  /**
   * Returns the computed ancestor path if the resolved path, or any ancestor
   * of it, is a computed signal. Returns `null` if no computed is in the path.
   */
  private _findComputedAncestor(sResolvedPath: string): string | null {
    if (!this.registry.hasComputeds) {
      return null;
    }
    if (this.registry.isComputed(sResolvedPath)) {
      return sResolvedPath;
    }
    const aParts = sResolvedPath.substring(1).split("/");
    let sAncestor = "";
    for (let i = 0; i < aParts.length - 1; i++) {
      sAncestor += "/" + aParts[i];
      if (this.registry.isComputed(sAncestor)) {
        return sAncestor;
      }
    }
    return null;
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
    // Also re-subscribe bindings at sub-paths of this computed.
    // When a computed at "/c" is redefined, bindings at "/c/name"
    // must switch their watcher from the old signal to the new one.
    //
    // Snapshot matching entries before iteration: each callback calls
    // subscribe() which removes and re-inserts the entry in _pathSubscribers,
    // causing the live Map iterator to revisit it and loop indefinitely.
    const prefix = path + "/";
    const subEntries: Array<() => void>[] = [];
    for (const [subscribedPath, set] of this._pathSubscribers) {
      if (subscribedPath.startsWith(prefix)) {
        subEntries.push(Array.from(set));
      }
    }
    for (const callbacks of subEntries) {
      for (const cb of callbacks) cb();
    }
  }

  override destroy(): void {
    // Abort all in-flight loadData requests (matching JSONModel's XHR abort behavior)
    this._abortController?.abort();
    this._abortController = null;
    this._pathSubscribers.clear();
    this.registry.destroy();
    super.destroy();
  }
}
