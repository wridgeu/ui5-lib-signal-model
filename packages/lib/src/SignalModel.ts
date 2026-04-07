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
  resolve(path: string, oContext?: Context): string | undefined;
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
 * @since 0.1.0
 */
export default class SignalModel<T extends object = Record<string, unknown>> extends ClientModel {
  private registry: SignalRegistry;
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
   * @returns Promise that resolves when data is loaded
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
    const effectiveCache =
      cache === undefined ? (this as unknown as { bCache: boolean }).bCache : cache;
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

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...customHeaders,
    };

    // POST body: form-encoded to match JSONModel (jQuery.ajax processData default).
    // JSONModel sends object params as "key=val&key2=val2" with
    // Content-Type: application/x-www-form-urlencoded. String params are sent as-is.
    // Callers wanting JSON POST must stringify manually and set Content-Type via customHeaders.
    let body: string | undefined;
    if (method !== "GET" && parameters) {
      body =
        typeof parameters === "string" ? parameters : new URLSearchParams(parameters).toString();
      if (!customHeaders?.["Content-Type"]) {
        headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
      }
    }

    this.fireRequestSent({
      url,
      type: method,
      async: true,
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
          if (merge) {
            this.setData(data as Partial<T>, true);
          } else {
            this.setData(data);
          }
          this.fireRequestCompleted({
            url,
            type: method,
            async: true,
            info,
            infoObject,
            success: true,
          });
        },
        (error: Error & { statusCode?: number; statusText?: string; responseText?: string }) => {
          const errorInfo = {
            message: error.message,
            statusCode: String(error.statusCode ?? 0),
            statusText: error.statusText ?? error.message,
            responseText: error.responseText ?? "",
          };
          this.fireRequestCompleted({
            url,
            type: method,
            async: true,
            info,
            infoObject,
            success: false,
            errorobject: errorInfo,
          });
          this.fireRequestFailed(errorInfo);
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
    (this as unknown as { bCache: boolean }).bCache = !noCache;
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
      });
    }
  }

  /** @since 0.1.0 */
  setData(data: T): void;
  /** @since 0.1.0 */
  setData(data: Partial<T>, merge: true): void;
  setData(data: T | Partial<T>, merge?: boolean): void {
    if (merge) {
      // In-place merge: walk the payload and apply changes directly to this.oData.
      // O(k) where k = payload size, instead of O(n) deep clone of all data.
      this._mergeInPlace(
        this.oData as Record<string, unknown>,
        data as Record<string, unknown>,
        "",
      );
    } else {
      this.oData = data as T;
      this.registry.invalidateAll((path: string) => this._getObject(path));
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
    if (!context || typeof (context as Context).getPath === "function") {
      const resolvedPath = asInternal(this).resolve(path, context as Context | undefined);
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
    const resolvedPath = asInternal(this).resolve(path, context);
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

    if (!parent) {
      if (!this.autoCreatePaths) {
        return false;
      }
      parent = this._createPath(objectPath);
    }

    if (this.strictLeafCheck && !(propertyName in parent)) {
      return false;
    }
    parent[propertyName] = value;

    if (this.registry.size > 0) {
      if (asyncUpdate) {
        // Deferred mode: skip signal notification, schedule a bulk sync.
        // This avoids 2000 synchronous notify callbacks during a batch
        // of setProperty calls -- the signals are synced once afterward.
        this._scheduleBulkSync();
      } else {
        this.registry.set(resolvedPath, value);
        this._invalidateParentSignals(resolvedPath);
        this.registry.invalidateChildren(resolvedPath, (p: string) => this._getObject(p));
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
    if (existing && typeof existing === "object" && typeof value === "object" && value !== null) {
      // In-place merge: walk the payload, compare, overwrite, and fire signals in one pass.
      // _mergeInPlace already calls _invalidateParentSignals internally.
      this._mergeInPlace(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
        resolvedPath,
      );

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

  /** Used by binding classes, not part of the public API. @internal */
  _getObject(path: string, context?: object): unknown {
    // If context is a raw data object (not a Context instance), navigate into it directly.
    // This is needed for FilterProcessor/SorterProcessor which pass raw list items as context.
    if (context && typeof (context as Context).getPath !== "function") {
      let node: unknown = context;
      // Walk the path without allocating arrays. This branch is called
      // per-row during FilterProcessor/SorterProcessor operations.
      let start = 0;
      while (start < path.length) {
        if (path[start] === "/") {
          start++;
          continue;
        }
        const end = path.indexOf("/", start);
        const part = end === -1 ? path.substring(start) : path.substring(start, end);
        if (node === null || node === undefined) return undefined;
        node = (node as Record<string, unknown>)[part];
        start = end === -1 ? path.length : end + 1;
      }
      return node;
    }

    let node: unknown = this.oData;

    const resolvedPath = asInternal(this).resolve(path, context as Context | undefined);
    if (!resolvedPath) {
      return null;
    }

    // Computed signals live in the registry, not in oData.
    // Return the computed value so list/tree bindings can see it.
    if (this.registry.isComputed(resolvedPath)) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- guarded by isComputed() check
      return this.registry.get(resolvedPath)!.get();
    }

    if (resolvedPath === "/") {
      return this.oData;
    }

    const parts = resolvedPath.substring(1).split("/");
    if (this.registry.hasComputeds) {
      let currentPath = "";
      for (const part of parts) {
        if (!part) break;
        currentPath += "/" + part;

        if (this.registry.isComputed(currentPath)) {
          // oxlint-disable-next-line typescript/no-non-null-assertion -- guarded by isComputed() check
          node = this.registry.get(currentPath)!.get();
          continue;
        }

        if (node === null || node === undefined) {
          return node;
        }
        node = (node as Record<string, unknown>)[part];
      }
    } else {
      for (const part of parts) {
        if (!part) break;
        if (node === null || node === undefined) {
          return node;
        }
        node = (node as Record<string, unknown>)[part];
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

  private _createPath(path: string): Record<string, unknown> {
    let node: Record<string, unknown> = this.oData as Record<string, unknown>;
    const parts = path.substring(1).split("/");

    for (const part of parts) {
      if (part === "" || part === "__proto__" || part === "constructor" || part === "prototype") {
        continue;
      }
      if (!(part in node) || node[part] === null || node[part] === undefined) {
        node[part] = {};
      }
      node = node[part] as Record<string, unknown>;
    }
    return node;
  }

  private _invalidateParentSignals(path: string): void {
    let idx = path.lastIndexOf("/");
    while (idx > 0) {
      const parentPath = path.substring(0, idx);
      if (this.registry.has(parentPath)) {
        this.registry.set(parentPath, this._getObject(parentPath));
      }
      idx = path.lastIndexOf("/", idx - 1);
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
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }
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
    // basePath is "" for the root merge call -- skip parent invalidation since root has no parent.
    if (basePath) {
      this._invalidateParentSignals(basePath);
    }
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
    // Abort all in-flight loadData requests (matching JSONModel's XHR abort behavior)
    this._abortController?.abort();
    this._abortController = null;
    this._pathSubscribers.clear();
    this.registry.destroy();
    super.destroy();
  }
}
