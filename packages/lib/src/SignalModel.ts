import ClientModel from "sap/ui/model/ClientModel";
import Log from "sap/base/Log";
import deepExtend from "sap/base/util/deepExtend";
import type Context from "sap/ui/model/Context";
import SignalRegistry from "./SignalRegistry";
import SignalPropertyBinding from "./SignalPropertyBinding";
import SignalListBinding from "./SignalListBinding";
import SignalTreeBinding from "./SignalTreeBinding";
import type { SignalModelOptions, ModelPath, PathValue } from "./types";
import type { Signal } from "signal-polyfill";

// Runtime properties/methods on ClientModel not exposed by @openui5/types stubs.
type ClientModelInternal = ClientModel & {
  resolve(path: string, oContext?: Context): string | undefined;
  checkUpdate(bForceUpdate?: boolean, bAsync?: boolean): number;
  fireRequestSent(parameters: Record<string, unknown>): ClientModel;
  fireRequestCompleted(parameters: Record<string, unknown>): ClientModel;
  bDestroyed: boolean;
  bCache: boolean;
};

/** A `{}`-style object: what a merge descends into (not Date, class instances, arrays). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Number of segments in an absolute path below the root: "/a" is 1, "/a/b" is 2. */
function depthOf(path: string): number {
  let depth = 1;
  for (let idx = path.indexOf("/", 1); idx !== -1; idx = path.indexOf("/", idx + 1)) depth++;
  return depth;
}

/** Path of an array's `length`, for the array at `arrayPath`. */
function lengthPath(arrayPath: string): string {
  return arrayPath === "/" ? "/length" : `${arrayPath}/length`;
}

function asInternal(self: ClientModel): ClientModelInternal {
  return self as unknown as ClientModelInternal;
}

/**
 * Reactive UI5 model using TC39 Signals for push-based change notification.
 * Drop-in replacement for JSONModel.
 *
 * @namespace ui5.model.signal
 * @since 0.1.0
 */
export default class SignalModel<T extends object = Record<string, unknown>> extends ClientModel {
  private registry: SignalRegistry;
  /** The subscribed list bindings: a merge has to reach them. Used by SignalListBinding. @internal */
  _listBindings = new Set<SignalListBinding>();
  private autoCreatePaths: boolean;
  private strictLeafCheck: boolean;
  private _pathSubscribers = new Map<string, Set<() => void>>();
  private _importChain: Promise<void> = Promise.resolve();
  private _abortController: AbortController | null = new AbortController();
  declare oData: T;

  constructor(url: string, options?: SignalModelOptions);
  constructor(data?: T, options?: SignalModelOptions);
  constructor(dataOrUrl?: T | string, options?: SignalModelOptions) {
    super();
    this.registry = new SignalRegistry();
    this.autoCreatePaths = options?.autoCreatePaths ?? false;
    this.strictLeafCheck = options?.strictLeafCheck ?? false;

    if (typeof dataOrUrl === "string") {
      this.oData = {} as T;
      this.loadData(dataOrUrl);
    } else {
      this.oData = (dataOrUrl || {}) as T;
    }
  }

  /**
   * Load data from a URL. JSONModel-compatible API.
   *
   * Uses `fetch()` internally. Fires `requestSent`, `requestCompleted`,
   * and `requestFailed` events matching the JSONModel contract.
   * Calls are chained sequentially, matching JSONModel's `pSequentialImportCompleted` behavior.
   *
   * @param url URL to load JSON from
   * @param parameters Query parameters (appended to URL for GET, sent as body for POST)
   * @param _async Has no effect. Kept for JSONModel.loadData signature compatibility.
   * @param type HTTP method: "GET" (default) or "POST"
   * @param merge Whether to merge loaded data instead of replacing
   * @param cache Set to false to append a cache-busting timestamp
   * @param customHeaders Additional HTTP headers
   * @param abortSignal AbortSignal to cancel the request (SignalModel extension)
   * @returns Promise that resolves when data is loaded and, like JSONModel, rejects with
   *   `{ message, statusCode, statusText, responseText }` when the request fails
   * @since 0.1.0
   */
  loadData(
    url: string,
    parameters?: Record<string, string> | string,
    _async?: undefined,
    type?: string,
    merge?: boolean,
    cache?: boolean,
    customHeaders?: Record<string, string>,
    abortSignal?: AbortSignal,
  ): Promise<void>;
  /**
   * @deprecated The `_async` parameter has no effect. SignalModel uses the Fetch API, which is
   *   inherently asynchronous. The behavior matches JSONModel but requests are always async
   *   regardless of this flag. Use the overload without `_async` instead.
   */
  loadData(
    url: string,
    parameters: Record<string, string> | string | undefined,
    _async: boolean,
    type?: string,
    merge?: boolean,
    cache?: boolean,
    customHeaders?: Record<string, string>,
    abortSignal?: AbortSignal,
  ): Promise<void>;
  loadData(
    url: string,
    parameters?: Record<string, string> | string,
    _async?: boolean,
    type?: string,
    merge?: boolean,
    cache?: boolean,
    customHeaders?: Record<string, string>,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    if (asInternal(this).bDestroyed) {
      return Promise.resolve();
    }
    const method = type || "GET";
    let fullURL = url;
    // Fall back to model-level cache setting (set via forceNoCache), matching JSONModel.
    const effectiveCache = cache === undefined ? asInternal(this).bCache : cache;
    const info = "cache=" + effectiveCache + ";bMerge=" + merge;
    const infoObject = { cache: effectiveCache, merge };

    // Append parameters to URL for GET, matching JSONModel behavior
    if (parameters && method === "GET") {
      const paramString =
        typeof parameters === "string" ? parameters : new URLSearchParams(parameters).toString();
      fullURL += (url.includes("?") ? "&" : "?") + paramString;
    }

    if (effectiveCache === false) {
      fullURL += (fullURL.includes("?") ? "&" : "?") + "_=" + Date.now();
    }

    // Header names are case-insensitive: a custom "accept" replaces the default
    const headers: Record<string, string> = { ...customHeaders };
    if (!Object.keys(headers).some((name) => name.toLowerCase() === "accept")) {
      headers.Accept = "application/json";
    }

    // POST body: form-encoded to match JSONModel (jQuery.ajax processData default).
    // JSONModel sends object params as "key=val&key2=val2" with
    // Content-Type: application/x-www-form-urlencoded. String params are sent as-is.
    // Callers wanting JSON POST must stringify manually and set Content-Type via customHeaders.
    let body: string | undefined;
    if (method !== "GET" && parameters) {
      body =
        typeof parameters === "string" ? parameters : new URLSearchParams(parameters).toString();
      const hasContentType =
        customHeaders !== undefined &&
        Object.keys(customHeaders).some((k) => k.toLowerCase() === "content-type");
      if (!hasContentType) {
        headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
      }
    }

    asInternal(this).fireRequestSent({
      url,
      type: method,
      async: true,
      headers: customHeaders,
      info,
      infoObject,
    });

    // Combine the model's internal abort signal with any user-provided signal.
    // AbortSignal.any() fires when either signal aborts -- on destroy() or caller abort.
    // oxlint-disable-next-line typescript/no-non-null-assertion -- initialized in constructor
    const abortSignals = [this._abortController!.signal, abortSignal].filter(
      Boolean,
    ) as AbortSignal[];
    const combinedSignal =
      abortSignals.length === 1 ? abortSignals[0] : AbortSignal.any(abortSignals);

    const importPromise = fetch(fullURL, {
      method,
      headers,
      signal: combinedSignal,
      body,
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
    const returnPromise = this._importChain.then(() =>
      importPromise.then(
        (data: T) => {
          if (asInternal(this).bDestroyed) {
            return;
          }
          if (merge) {
            this.setData(data as Partial<T>, true);
          } else {
            this.setData(data);
          }
          asInternal(this).fireRequestCompleted({
            url,
            type: method,
            async: true,
            headers: customHeaders,
            info,
            infoObject,
            success: true,
          });
        },
        (error: Error & { statusCode?: number; statusText?: string; responseText?: string }) => {
          if (asInternal(this).bDestroyed) {
            return;
          }
          const errorInfo = {
            message: error.message,
            statusCode: error.statusCode ?? 0,
            statusText: error.statusText ?? error.message,
            responseText: error.responseText ?? "",
          };
          asInternal(this).fireRequestCompleted({
            url,
            type: method,
            async: true,
            headers: customHeaders,
            info,
            infoObject,
            success: false,
            errorobject: errorInfo,
          });
          this.fireRequestFailed(errorInfo);
          // Like JSONModel: the returned promise rejects with the error object
          return Promise.reject(errorInfo);
        },
      ),
    );

    this._importChain = returnPromise.catch(() => {
      // Swallow errors so the chain stays alive for subsequent calls
    });

    return returnPromise;
  }

  /**
   * Returns a Promise that resolves when all pending loadData calls complete.
   * Calls queued after this point are not included.
   * JSONModel-compatible API.
   *
   * @returns Promise that resolves when pending imports finish
   * @since 0.1.0
   */
  dataLoaded(): Promise<void> {
    return this._importChain;
  }

  /**
   * Set whether `loadData` calls should bypass the browser cache.
   * JSONModel-compatible API.
   *
   * @param noCache When true, a cache-buster parameter is appended to every `loadData` URL.
   * @since 0.1.0
   */
  forceNoCache(noCache: boolean): void {
    asInternal(this).bCache = !noCache;
  }

  /**
   * Serialize model data as a JSON string. JSONModel-compatible API.
   *
   * @returns JSON stringified model data
   * @since 0.1.0
   */
  getJSON(): string {
    return JSON.stringify(this.oData);
  }

  /**
   * Parse a JSON string and set it as model data. JSONModel-compatible API.
   *
   * @param json JSON string to parse
   * @param merge Whether to merge into existing data instead of replacing
   * @since 0.1.0
   */
  setJSON(json: string, merge?: boolean): void {
    try {
      const data = JSON.parse(json) as T;
      if (merge) {
        this.setData(data as Partial<T>, true);
      } else {
        this.setData(data);
      }
    } catch (e) {
      Log.fatal(
        "The following problem occurred: JSON parse Error: " + e,
        undefined,
        "ui5.model.signal.SignalModel",
      );
      this.fireParseError({
        url: "",
        errorCode: -1,
        reason: "",
        srcText: e instanceof Error ? e.message : String(e),
        line: -1,
        linepos: -1,
        filepos: -1,
      });
    }
  }

  /** @since 0.1.0 */
  setData(data: T): void;
  /** @since 0.1.0 */
  setData(data: Partial<T>, merge: true): void;
  setData(data: T | Partial<T>, merge?: boolean): void {
    if (merge) {
      if (!data || typeof data !== "object") {
        return;
      }
      if (!this.oData || typeof this.oData !== "object") {
        this.oData = (Array.isArray(data) ? [] : {}) as T;
      }
      // In-place merge: walk the payload and apply changes directly to this.oData.
      // O(k) where k = payload size, instead of O(n) deep clone of all data.
      this._mergeInPlace(
        this.oData as Record<string, unknown>,
        data as Record<string, unknown>,
        "",
      );
      for (const binding of this._listBindings) binding._onMerge("/");
    } else {
      this.oData = data as T;
      if (this.registry.size > 0) {
        this.registry.invalidateAll((path: string) => this._getObject(path));
      }
    }
  }

  /**
   * @returns The model data
   * @since 0.1.0
   */
  getData(): T {
    return this.oData;
  }

  /** @since 0.1.0 */
  getProperty<P extends string & ModelPath<T>>(path: P, context?: undefined): PathValue<T, P>;
  /** @since 0.1.0 */
  getProperty(path: string, context?: object): unknown;
  getProperty(path: string, context?: object): unknown {
    // Only resolve computed check for proper Context objects (not raw data items from FilterProcessor)
    if (
      this.registry.hasComputeds &&
      (!context || typeof (context as Context).getPath === "function")
    ) {
      const resolvedPath = this._resolvePath(path, context as Context | undefined);
      if (resolvedPath && this.registry.isComputed(resolvedPath)) {
        // oxlint-disable-next-line typescript/no-non-null-assertion -- guarded by isComputed() check
        return this.registry.get(resolvedPath)!.get();
      }
    }
    return this._getObject(path, context);
  }

  /** @since 0.1.0 */
  setProperty<P extends string & ModelPath<T>>(
    path: P,
    value: PathValue<T, P>,
    context?: undefined,
    asyncUpdate?: boolean,
  ): boolean;
  /** @since 0.1.0 */
  setProperty(path: string, value: unknown, context?: Context, asyncUpdate?: boolean): boolean;
  setProperty(path: string, value: unknown, context?: Context, asyncUpdate?: boolean): boolean {
    const resolvedPath = this._resolvePath(path, context);
    if (!resolvedPath) {
      return false;
    }

    const computedAncestor = this._findComputedAncestor(resolvedPath);
    if (computedAncestor) {
      Log.warning(
        `Cannot set value at "${resolvedPath}": ` +
          (computedAncestor === resolvedPath
            ? "path is a computed signal (read-only)"
            : `ancestor "${computedAncestor}" is a computed signal (read-only)`),
        undefined,
        "ui5.model.signal.SignalModel",
      );
      return false;
    }

    if (resolvedPath === "/") {
      this.setData(value as T);
      return true;
    }

    const lastSlash = resolvedPath.lastIndexOf("/");
    const objectPath = resolvedPath.substring(0, lastSlash || 1);
    const propertyName = resolvedPath.substring(lastSlash + 1);

    let parent = this._getObject(objectPath) as Record<string, unknown> | undefined;

    // Like JSONModel, a function can hold properties; other primitives cannot
    if (!parent || (typeof parent !== "object" && typeof parent !== "function")) {
      const created = this.autoCreatePaths && this._createPath(objectPath);
      if (!created) {
        return false;
      }
      parent = created;
    }

    if (this.strictLeafCheck && !(propertyName in parent)) {
      return false;
    }
    parent[propertyName] = value;

    if (this.registry.size > 0) {
      if (asyncUpdate) {
        // Deferred mode: record dirty path and schedule a single batched sync.
        // Avoids synchronous watcher notifications during a batch of writes,
        // and syncs only the dirty paths instead of scanning the entire registry.
        this._pendingAsyncPaths.add(resolvedPath);
        if (Array.isArray(parent)) {
          this._pendingAsyncPaths.add(
            propertyName === "length" ? objectPath : lengthPath(objectPath),
          );
        }
        this._scheduleBulkSync();
      } else {
        this.registry.set(resolvedPath, value);
        this._invalidateParentSignals(resolvedPath);
        // Also for primitives: a binding may point below one (e.g. "/name/length")
        this.registry.invalidateChildren(resolvedPath, this._readPath);
        // An array write changes more than the written path: its length, or,
        // when the length itself is written, which elements exist.
        if (Array.isArray(parent)) {
          if (propertyName === "length") {
            this.registry.invalidateChildren(objectPath, this._readPath);
          } else {
            this.registry.set(lengthPath(objectPath), parent.length);
          }
        }
      }
    }

    return true;
  }

  private _bulkSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingAsyncPaths = new Set<string>();
  private readonly _readPath = (path: string): unknown => this._getObject(path);

  /**
   * Schedule a single deferred sync of all dirty paths from `bAsyncUpdate=true` writes.
   *
   * Instead of scanning the entire registry (`invalidateAll`), only the paths written
   * during the batch (plus their ancestor state signals, deduplicated) are synced.
   * Sparse async writes stay O(1) while bulk async writes stay O(N).
   */
  private _scheduleBulkSync(): void {
    if (this._bulkSyncTimer === null) {
      this._bulkSyncTimer = setTimeout(() => {
        this._bulkSyncTimer = null;
        if (asInternal(this).bDestroyed || this._pendingAsyncPaths.size === 0) {
          this._pendingAsyncPaths.clear();
          return;
        }
        const dirty = this._pendingAsyncPaths;
        this._pendingAsyncPaths = new Set();
        const invalidatedParents = new Set<string>();

        for (const path of dirty) {
          const signal = this.registry.getState(path);
          if (signal) {
            signal.set(this._getObject(path));
          }
          this.registry.invalidateChildren(path, this._readPath);
          if (this.registry.minDepth >= depthOf(path)) {
            continue; // no signal above this path
          }
          // Deduplicated ancestor invalidation
          let idx = path.lastIndexOf("/");
          while (idx > 0) {
            const parentPath = path.substring(0, idx);
            if (invalidatedParents.has(parentPath)) {
              break;
            }
            invalidatedParents.add(parentPath);
            const parentSignal = this.registry.getState(parentPath);
            if (parentSignal) {
              parentSignal.set(this._getObject(parentPath));
            }
            idx = path.lastIndexOf("/", idx - 1);
          }
          if (!invalidatedParents.has("/")) {
            invalidatedParents.add("/");
            const rootSignal = this.registry.getState("/");
            if (rootSignal) {
              rootSignal.set(this.oData);
            }
          }
        }
      }, 0);
    }
  }

  /** @since 0.1.0 */
  mergeProperty<P extends string & ModelPath<T>>(path: P, value: Partial<PathValue<T, P>>): boolean;
  /** @since 0.1.0 */
  mergeProperty(path: string, value: unknown, context?: Context): boolean;
  mergeProperty(path: string, value: unknown, context?: Context): boolean {
    const resolvedPath = asInternal(this).resolve(path, context);
    if (!resolvedPath) {
      return false;
    }

    // Root path: delegate to setData with merge
    if (resolvedPath === "/") {
      if (typeof value === "object" && value !== null) {
        this.setData(value as T, true);
        return true;
      }
      return false;
    }

    const computedAncestor = this._findComputedAncestor(resolvedPath);
    if (computedAncestor) {
      Log.warning(
        `Cannot merge value at "${resolvedPath}": ` +
          (computedAncestor === resolvedPath
            ? "path is a computed signal (read-only)"
            : `ancestor "${computedAncestor}" is a computed signal (read-only)`),
        undefined,
        "ui5.model.signal.SignalModel",
      );
      return false;
    }

    const existing = this._getObject(resolvedPath);
    // Like a merge with setData: only two arrays or two plain objects are merged
    if (
      (Array.isArray(existing) && Array.isArray(value)) ||
      (isPlainObject(existing) && isPlainObject(value))
    ) {
      // In-place merge: walk the payload, compare, overwrite, and fire signals in one pass.
      const changed = this._mergeInPlace(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
        resolvedPath,
      );
      if (changed && this.registry.size > 0) {
        for (const binding of this._listBindings) binding._onMerge(resolvedPath);
        this._invalidateParentSignals(resolvedPath);
      }

      return true;
    }

    return this.setProperty(path, value, context);
  }

  /** @since 0.1.0 */
  override bindProperty(
    path: string,
    context?: Context,
    parameters?: object,
  ): SignalPropertyBinding {
    // ClientPropertyBinding's constructor is protected in type stubs but callable from subclasses at runtime
    const binding = new (SignalPropertyBinding as unknown as new (
      // oxlint-disable-next-line typescript/no-explicit-any -- UI5 type stubs: protected constructor workaround
      model: SignalModel<any>,
      path: string,
      context?: Context,
      params?: object,
    ) => SignalPropertyBinding)(this, path, context, parameters);
    binding.subscribe();
    return binding;
  }

  /** @since 0.1.0 */
  override bindList(
    path: string,
    context?: Context,
    sorters?: object | object[],
    filters?: object | object[],
    parameters?: object,
  ): SignalListBinding {
    const binding = new (SignalListBinding as unknown as new (
      // oxlint-disable-next-line typescript/no-explicit-any -- UI5 type stubs: protected constructor workaround
      model: SignalModel<any>,
      path: string,
      context?: Context,
      sorters?: object | object[],
      filters?: object | object[],
      params?: object,
    ) => SignalListBinding)(this, path, context, sorters, filters, parameters);
    binding.subscribe();
    return binding;
  }

  /** @since 0.1.0 */
  override bindTree(
    path: string,
    context?: Context,
    filters?: object | object[],
    parameters?: object,
    sorters?: object | object[],
  ): SignalTreeBinding {
    const binding = new (SignalTreeBinding as unknown as new (
      // oxlint-disable-next-line typescript/no-explicit-any -- UI5 type stubs: protected constructor workaround
      model: SignalModel<any>,
      path: string,
      context?: Context,
      filters?: object | object[],
      params?: object,
      sorters?: object | object[],
    ) => SignalTreeBinding)(this, path, context, filters, parameters, sorters);
    binding.subscribe();
    return binding;
  }

  /**
   * @param path Binding path to check
   * @param context Optional binding context for relative paths
   * @returns Whether the value at the given path is an array
   * @since 0.1.0
   */
  isList(path: string, context?: Context): boolean {
    const absolutePath = asInternal(this).resolve(path, context);
    if (!absolutePath) return false;
    return Array.isArray(this._getObject(absolutePath));
  }

  /**
   * @param forceUpdate Whether to force bindings to re-evaluate
   * @param asyncMode Whether to update asynchronously
   * @since 0.1.0
   */
  checkUpdate(forceUpdate?: boolean, asyncMode?: boolean): void {
    // Signal-based bindings self-update via watchers, so routine polling
    // (forceUpdate=false) is unnecessary. However, the framework calls
    // checkUpdate(true) during context propagation (e.g. setBindingContext)
    // -- delegate to Model.prototype.checkUpdate so bindings re-evaluate.
    if (forceUpdate) {
      (ClientModel.prototype as unknown as ClientModelInternal).checkUpdate.call(
        this,
        forceUpdate,
        asyncMode,
      );
    }
  }

  /** @since 0.1.0 */
  getSignal<P extends string & ModelPath<T>>(
    path: P,
  ): Signal.State<PathValue<T, P>> | Signal.Computed<PathValue<T, P>>;
  /** @since 0.1.0 */
  getSignal(path: string): Signal.State<unknown> | Signal.Computed<unknown>;
  getSignal(path: string): Signal.State<unknown> | Signal.Computed<unknown> {
    const existing = this.registry.get(path);
    if (existing) return existing;

    // If a parent path is a computed signal, subscribe to it instead.
    // Search bottom-up (closest ancestor first) so bindings track the
    // most specific computed. Uses lastIndexOf to avoid array allocation.
    if (this.registry.hasComputeds) {
      let idx = path.lastIndexOf("/");
      while (idx > 0) {
        const parentPath = path.substring(0, idx);
        if (this.registry.isComputed(parentPath)) {
          // oxlint-disable-next-line typescript/no-non-null-assertion -- guarded by isComputed() check
          return this.registry.get(parentPath)!;
        }
        idx = path.lastIndexOf("/", idx - 1);
      }
    }

    return this.registry.getOrCreate(path, this._getObject(path));
  }

  /** @since 0.1.0 */
  createComputed(
    path: string,
    deps: string[],
    fn: (...args: unknown[]) => unknown,
  ): Signal.Computed<unknown> {
    // Ensure dependency signals exist before creating the computed.
    // Skip deps that already exist -- they may be computed signals from
    // a chained computed, and getOrCreate would shadow them with orphaned state signals.
    for (const dep of deps) {
      if (!this.registry.has(dep)) {
        this.registry.getOrCreate(dep, this._getObject(dep));
      }
    }
    const result = this.registry.addComputed(path, deps, fn);
    // Re-subscribe any bindings that were watching a previous computed at this path.
    // No-op if no bindings exist (Map lookup returns undefined).
    this._firePathResubscribe(path);
    return result;
  }

  /**
   * @param path Path of the computed signal to remove
   * @since 0.1.0
   */
  removeComputed(path: string): void {
    this.registry.removeComputed(path);
  }

  /** Used by binding classes to check whether a signal is registered directly at `path`. @internal */
  _getExactSignal(path: string): Signal.State<unknown> | Signal.Computed<unknown> | undefined {
    return this.registry.get(path);
  }

  /**
   * Fast path for resolving a path with optional context.
   * Avoids calling ClientModel.prototype.resolve when the path is already an
   * absolute path without a trailing slash (the common case).
   */
  private _resolvePath(path: string, context?: Context): string | undefined {
    if (
      !context &&
      typeof path === "string" &&
      path.length > 0 &&
      path.charCodeAt(0) === 47 &&
      (path.length === 1 || path.charCodeAt(path.length - 1) !== 47)
    ) {
      return path;
    }
    return asInternal(this).resolve(path, context);
  }

  /** Used by binding classes, not part of the public API. @internal */
  _getObject(path: string, context?: object): unknown {
    // If context is a raw data object (not a Context instance), navigate into it directly.
    // This is needed for FilterProcessor/SorterProcessor which pass raw list items as context.
    // A falsy item ("" or 0 in a sorted list) is a context too, as in JSONModel.
    // An absolute path ignores the context and is resolved below.
    if (
      context != null &&
      typeof (context as Context).getPath !== "function" &&
      path.charCodeAt(0) !== 47
    ) {
      let node: unknown = context;
      let start = 0;
      while (start < path.length) {
        const end = path.indexOf("/", start);
        const part = end === -1 ? path.substring(start) : path.substring(start, end);
        if (!part) break;
        if (!node) return node;
        node = (node as Record<string, unknown>)[part];
        if (end === -1) break;
        start = end + 1;
      }
      return node;
    }

    let node: unknown = this.oData;

    const resolvedPath = this._resolvePath(path, context as Context | undefined);
    if (!resolvedPath) {
      return null;
    }

    // Computed signals live in the registry, not in oData.
    // Return the computed value so list/tree bindings can see it.
    if (this.registry.hasComputeds && this.registry.isComputed(resolvedPath)) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- guarded by isComputed() check
      return this.registry.get(resolvedPath)!.get();
    }

    if (resolvedPath === "/") {
      return this.oData;
    }

    if (this.registry.hasComputeds) {
      let currentPath = "";
      let start = 1;
      while (start < resolvedPath.length) {
        const end = resolvedPath.indexOf("/", start);
        const part =
          end === -1 ? resolvedPath.substring(start) : resolvedPath.substring(start, end);
        if (!part) break;
        currentPath += "/" + part;

        if (this.registry.isComputed(currentPath)) {
          // oxlint-disable-next-line typescript/no-non-null-assertion -- guarded by isComputed() check
          node = this.registry.get(currentPath)!.get();
        } else {
          if (!node) {
            return node;
          }
          node = (node as Record<string, unknown>)[part];
        }
        if (end === -1) break;
        start = end + 1;
      }
    } else {
      let start = 1;
      while (start < resolvedPath.length) {
        const end = resolvedPath.indexOf("/", start);
        const part =
          end === -1 ? resolvedPath.substring(start) : resolvedPath.substring(start, end);
        if (!part) break;
        if (!node) {
          return node;
        }
        node = (node as Record<string, unknown>)[part];
        if (end === -1) break;
        start = end + 1;
      }
    }
    return node;
  }

  /**
   * Returns the computed ancestor path if the resolved path, or any ancestor
   * of it, is a computed signal. Returns `null` if no computed is in the path.
   */
  private _findComputedAncestor(resolvedPath: string): string | null {
    if (!this.registry.hasComputeds) {
      return null;
    }
    if (this.registry.isComputed(resolvedPath)) {
      return resolvedPath;
    }
    const parts = resolvedPath.substring(1).split("/");
    let ancestor = "";
    for (let i = 0; i < parts.length - 1; i++) {
      ancestor += "/" + parts[i];
      if (this.registry.isComputed(ancestor)) {
        return ancestor;
      }
    }
    return null;
  }

  /**
   * Creates the missing objects along `path` and returns the last one.
   * Only null and undefined count as missing: an existing value is never replaced, so the
   * result is `undefined` when a primitive is in the way.
   */
  private _createPath(path: string): Record<string, unknown> | undefined {
    const isContainer = (value: unknown): boolean =>
      typeof value === "object" || typeof value === "function";
    let createdAt = "";
    if (this.oData == null) {
      this.oData = {} as T;
      createdAt = "/";
    } else if (!isContainer(this.oData)) {
      return undefined;
    }
    let node = this.oData as Record<string, unknown>;
    let current = "";

    for (const part of path.substring(1).split("/")) {
      if (part === "" || part === "__proto__" || part === "constructor" || part === "prototype") {
        continue;
      }
      if (node[part] == null) {
        node[part] = {};
        createdAt ||= current + "/" + part;
        // A new element can grow the array
        if (Array.isArray(node)) {
          this.registry.set(`${current}/length`, node.length);
        }
      } else if (!isContainer(node[part])) {
        return undefined;
      }
      node = node[part] as Record<string, unknown>;
      current += "/" + part;
    }
    // Notified here, because strictLeafCheck can still reject the write itself.
    // Bindings below a created object showed the null that was there before.
    if (createdAt && this.registry.size > 0) {
      this.registry.set(createdAt, this._getObject(createdAt));
      this._invalidateParentSignals(createdAt);
      this.registry.invalidateChildren(createdAt, this._readPath);
    }
    return node;
  }

  private _invalidateParentSignals(path: string): void {
    if (this.registry.minDepth >= depthOf(path)) {
      return;
    }
    let idx = path.lastIndexOf("/");
    while (idx > 0) {
      const parentPath = path.substring(0, idx);
      const signal = this.registry.getState(parentPath);
      if (signal) {
        signal.set(this._getObject(parentPath));
      }
      idx = path.lastIndexOf("/", idx - 1);
    }
    // Check root
    const rootSignal = this.registry.getState("/");
    if (rootSignal) {
      rootSignal.set(this.oData);
    }
  }

  /**
   * In-place merge + signal notification in a single pass.
   *
   * Walks the payload, compares against existing data, overwrites in-place,
   * and fires signals for changed paths. O(k) where k = payload keys,
   * instead of O(n) deep clone of the entire data tree.
   *
   * Incoming object/array values are cloned via deepExtend to prevent
   * the caller from holding references into the model's internal data.
   *
   * @returns `true` if any property within this subtree changed.
   */
  private _mergeInPlace(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
    basePath: string,
  ): boolean {
    let changed = false;
    const hasSignals = this.registry.size > 0;

    for (const key of Object.keys(source)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }
      const childPath = basePath ? `${basePath}/${key}` : `/${key}`;
      const oldValue = target[key];
      const newValue = source[key];
      // Like JSONModel's deepExtend: an undefined value in the payload changes nothing
      if (newValue === undefined) {
        continue;
      }

      if (
        (Array.isArray(oldValue) && Array.isArray(newValue)) ||
        (isPlainObject(oldValue) && isPlainObject(newValue))
      ) {
        // Same container type (both arrays or both plain objects): recurse in-place.
        // Arrays are merged by index, matching deepExtend behavior.
        if (
          this._mergeInPlace(
            oldValue as Record<string, unknown>,
            newValue as Record<string, unknown>,
            childPath,
          )
        ) {
          changed = true;
        }
      } else if (!Object.is(oldValue, newValue)) {
        changed = true;
        // Clone incoming arrays and plain objects to prevent external mutation, with the
        // function JSONModel's merge uses: class instances inside stay the same instances.
        if (Array.isArray(newValue)) {
          target[key] = deepExtend([], newValue);
        } else if (isPlainObject(newValue)) {
          target[key] = deepExtend({}, newValue);
        } else {
          target[key] = newValue;
        }
        if (hasSignals) {
          this.registry.set(childPath, target[key]);
          this.registry.invalidateChildren(childPath, this._readPath);
        }
      }
    }
    if (changed && hasSignals) {
      // Update the base path signal (the object reference hasn't changed, but contents have).
      // Parent invalidation above the merge root is handled once by the top-level caller.
      const effectivePath = basePath || "/";
      this.registry.set(effectivePath, target);
      if (Array.isArray(target)) {
        this.registry.set(lengthPath(effectivePath), target.length);
      }
    }
    return changed;
  }

  /** Used by binding classes, not part of the public API. @internal */
  _onPathResubscribe(path: string, cb: () => void): void {
    let set = this._pathSubscribers.get(path);
    if (!set) {
      set = new Set();
      this._pathSubscribers.set(path, set);
    }
    set.add(cb);
  }

  /** Used by binding classes, not part of the public API. @internal */
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

  /** @since 0.1.0 */
  override destroy(): void {
    // Cancel any pending async bulk sync timer
    if (this._bulkSyncTimer !== null) {
      clearTimeout(this._bulkSyncTimer);
      this._bulkSyncTimer = null;
    }
    this._pendingAsyncPaths.clear();
    // Abort all in-flight loadData requests (matching JSONModel's XHR abort behavior)
    this._abortController?.abort();
    this._abortController = null;
    this._pathSubscribers.clear();
    this.registry.destroy();
    super.destroy();
  }
}
