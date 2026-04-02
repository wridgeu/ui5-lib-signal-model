import ClientModel from "sap/ui/model/ClientModel";
import Context from "sap/ui/model/Context";
import deepExtend from "sap/base/util/deepExtend";
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
  private strict: boolean;
  declare oData: T;

  constructor(oData?: T, mOptions?: SignalModelOptions) {
    super();
    this.oData = (oData || {}) as T;
    this.registry = new SignalRegistry();
    this.strict = mOptions?.strict ?? false;
  }

  setData(oData: T): void;
  setData(oData: Partial<T>, bMerge: true): void;
  setData(oData: T | Partial<T>, bMerge?: boolean): void {
    if (bMerge) {
      this.oData = deepExtend(Array.isArray(this.oData) ? [] : {}, this.oData, oData) as T;
      // Only invalidate paths that were part of the merge payload
      this._invalidateMergePayload(oData as Record<string, unknown>, "");
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
  setProperty(
    sPath: string,
    oValue: unknown,
    oContext?: Context,
    _bAsyncUpdate?: boolean,
  ): boolean {
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
      if (this.strict) {
        throw new TypeError(
          `Cannot set property at "${sResolvedPath}": path does not exist (strict mode)`,
        );
      }
      oObject = this._createPath(sObjectPath);
    }

    if (oObject) {
      // Strict mode: also check that the leaf property exists
      if (this.strict && !(sPropertyName in oObject)) {
        throw new TypeError(
          `Cannot set property at "${sResolvedPath}": path does not exist (strict mode)`,
        );
      }
      oObject[sPropertyName] = oValue;

      this.registry.set(sResolvedPath, oValue);

      this._invalidateParentSignals(sResolvedPath);

      if (typeof oValue === "object" && oValue !== null) {
        this.registry.invalidateChildren(sResolvedPath, (path: string) => this._getObject(path));
      }

      return true;
    }
    return false;
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
      const merged = deepExtend(Array.isArray(existing) ? [] : {}, existing, oValue) as Record<
        string,
        unknown
      >;

      const oParent = this._getObject(
        sResolvedPath.substring(0, sResolvedPath.lastIndexOf("/") || 1),
      ) as Record<string, unknown>;
      const prop = sResolvedPath.substring(sResolvedPath.lastIndexOf("/") + 1);
      oParent[prop] = merged;

      this._invalidateMergedPaths(sResolvedPath, existing as Record<string, unknown>, merged);
      this._invalidateParentSignals(sResolvedPath);

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
    return Array.isArray(this._getObject(sAbsolutePath!));
  }

  checkUpdate(_bForceUpdate?: boolean, _bAsync?: boolean): number {
    return 0;
  }

  getSignal<P extends string & ModelPath<T>>(sPath: P): Signal.State<PathValue<T, P>>;
  getSignal(sPath: string): Signal.State<unknown>;
  getSignal(sPath: string): Signal.State<unknown> {
    return this.registry.getOrCreate(sPath, this._getObject(sPath));
  }

  createComputed(
    sPath: string,
    aDeps: string[],
    fn: (...args: unknown[]) => unknown,
  ): Signal.Computed<unknown> {
    // Ensure dependency signals exist before creating the computed
    for (const dep of aDeps) {
      this.registry.getOrCreate(dep, this._getObject(dep));
    }
    return this.registry.addComputed(sPath, aDeps, fn, this.strict);
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
    const parts = sPath.split("/");
    for (let i = parts.length - 1; i >= 1; i--) {
      const parentPath = parts.slice(0, i).join("/") || "/";
      if (this.registry.has(parentPath)) {
        this.registry.set(parentPath, this._getObject(parentPath));
      }
    }
  }

  private _invalidateMergedPaths(
    basePath: string,
    oldData: Record<string, unknown>,
    newData: Record<string, unknown>,
  ): void {
    for (const key of Object.keys(newData)) {
      const childPath = `${basePath}/${key}`;
      const oldValue = oldData[key];
      const newValue = newData[key];

      if (oldValue !== newValue) {
        this.registry.set(childPath, newValue);

        // Recurse into nested objects for deep invalidation
        if (
          typeof oldValue === "object" &&
          oldValue !== null &&
          !Array.isArray(oldValue) &&
          typeof newValue === "object" &&
          newValue !== null &&
          !Array.isArray(newValue)
        ) {
          this._invalidateMergedPaths(
            childPath,
            oldValue as Record<string, unknown>,
            newValue as Record<string, unknown>,
          );
        } else if (typeof newValue === "object" && newValue !== null) {
          // New value is an object but old wasn't — invalidate all children
          this.registry.invalidateChildren(childPath, (path: string) => this._getObject(path));
        }
      }
    }
    this.registry.set(basePath, newData);
  }

  private _invalidateMergePayload(payload: Record<string, unknown>, basePath: string): void {
    for (const key of Object.keys(payload)) {
      const childPath = `${basePath}/${key}`;
      this.registry.set(childPath, this._getObject(childPath));

      const value = payload[key];
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        this._invalidateMergePayload(value as Record<string, unknown>, childPath);
      }

      // Also invalidate any registered child signals under this path
      this.registry.invalidateChildren(childPath, (path: string) => this._getObject(path));
    }
    // Invalidate the base path itself if it has a signal
    if (basePath) {
      this.registry.set(basePath, this._getObject(basePath));
    }
    // Invalidate parent paths
    if (basePath) {
      this._invalidateParentSignals(basePath);
    }
  }

  override destroy(): void {
    this.registry.destroy();
    super.destroy();
  }
}
