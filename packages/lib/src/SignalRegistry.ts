import { Signal } from "signal-polyfill";

type ValueResolver = (path: string) => unknown;

/**
 * Custom equality that uses Object.is for primitives but always returns false
 * for objects/arrays. This ensures that parent signals fire when child properties
 * are mutated in place (the parent reference doesn't change but its contents did).
 */
function signalEquals(_a: unknown, _b: unknown): boolean {
  // A function can hold properties too (JSONModel writes below one)
  if ((typeof _a === "object" && _a !== null) || typeof _a === "function") return false;
  return Object.is(_a, _b);
}

/**
 * Manages signal state and computed signals for path-based subscriptions.
 *
 * @since 0.1.0
 */
export default class SignalRegistry {
  private readonly signals = new Map<string, Signal.State<unknown>>();
  private readonly computeds = new Map<string, Signal.Computed<unknown>>();
  /**
   * Paths of the state signals below each path, filled as signals are created. Lets a
   * write reach its child signals directly instead of scanning the whole registry.
   */
  private readonly descendants = new Map<string, string[]>();
  /**
   * Depth of the shallowest state signal ("/" is 0, "/a" is 1, "/a/b" is 2). A write at
   * this depth or above has no signal among its ancestors, so the ancestor walk is skipped.
   */
  minDepth = Infinity;

  /**
   * @param path - Property path to look up or create.
   * @param initialValue - Value used when creating a new signal.
   * @returns The existing or newly created state signal.
   * @since 0.1.0
   */
  getOrCreate(path: string, initialValue: unknown): Signal.State<unknown> {
    let signal = this.signals.get(path);
    if (!signal) {
      signal = new Signal.State(initialValue, { equals: signalEquals });
      this.signals.set(path, signal);
      let depth = path === "/" ? 0 : 1;
      for (let idx = path.lastIndexOf("/"); idx > 0; idx = path.lastIndexOf("/", idx - 1)) {
        depth++;
        const ancestor = path.substring(0, idx);
        const below = this.descendants.get(ancestor);
        if (below) {
          below.push(path);
        } else {
          this.descendants.set(ancestor, [path]);
        }
      }
      if (depth < this.minDepth) {
        this.minDepth = depth;
      }
    }
    return signal;
  }

  /**
   * @param path - Property path to retrieve a state signal for.
   * @returns The state signal, or `undefined` if not registered.
   * @since 0.1.0
   */
  getState(path: string): Signal.State<unknown> | undefined {
    return this.signals.get(path);
  }

  /**
   * @param path - Property path to retrieve.
   * @returns The computed or state signal, or `undefined` if not registered.
   * @since 0.1.0
   */
  get(path: string): Signal.State<unknown> | Signal.Computed<unknown> | undefined {
    return this.computeds.get(path) ?? this.signals.get(path);
  }

  /**
   * @param path - Property path to check.
   * @returns `true` if a state or computed signal exists for the path.
   * @since 0.1.0
   */
  has(path: string): boolean {
    return this.signals.has(path) || this.computeds.has(path);
  }

  /**
   * @param path - Property path of the signal to update.
   * @param value - New value to set.
   * @since 0.1.0
   */
  set(path: string, value: unknown): void {
    const signal = this.signals.get(path);
    if (signal) {
      signal.set(value);
    }
  }

  /**
   * @param parentPath - Parent path whose children will be refreshed.
   * @param resolver - Callback that returns the current value for a given path.
   * @since 0.1.0
   */
  invalidateChildren(parentPath: string, resolver: ValueResolver): void {
    if (parentPath === "/") {
      this.invalidateAll(resolver); // every signal is below the root; the index has no "/" entry
      return;
    }
    const below = this.descendants.get(parentPath);
    if (below) {
      for (const path of below) {
        this.set(path, resolver(path));
      }
    }
  }

  /**
   * @param resolver - Callback that returns the current value for a given path.
   * @since 0.1.0
   */
  invalidateAll(resolver: ValueResolver): void {
    for (const [path, signal] of this.signals) {
      signal.set(resolver(path));
    }
  }

  /**
   * @param path - Property path for the computed signal.
   * @param deps - Paths of the dependency signals.
   * @param fn - Derivation function called with the dependency values.
   * @returns The newly created computed signal.
   * @since 0.1.0
   */
  addComputed(
    path: string,
    deps: string[],
    fn: (...args: unknown[]) => unknown,
  ): Signal.Computed<unknown> {
    if (this.signals.has(path)) {
      throw new TypeError(
        `Cannot create computed signal at "${path}": path already holds raw data`,
      );
    }

    if (this.computeds.has(path)) {
      throw new TypeError(
        `Cannot create computed at "${path}": already exists (call removeComputed first)`,
      );
    }

    const computed = new Signal.Computed(
      () => {
        const values = deps.map((dep) => {
          const s = this.get(dep);
          return s ? s.get() : undefined;
        });
        return fn(...values);
      },
      { equals: signalEquals },
    );

    // Eagerly evaluate so the dependency graph is established immediately.
    // Without this, a Watcher attached to an unevaluated computed cannot
    // detect when upstream signals change (the computed has no subscriptions
    // to its dependencies until its first .get() call).
    computed.get();

    this.computeds.set(path, computed);
    return computed;
  }

  /**
   * @param path - Property path of the computed signal to remove.
   * @since 0.1.0
   */
  removeComputed(path: string): void {
    this.computeds.delete(path);
  }

  /**
   * @param path - Property path to check.
   * @returns `true` if the path holds a computed signal.
   * @since 0.1.0
   */
  isComputed(path: string): boolean {
    return this.computeds.has(path);
  }

  /**
   * @returns `true` if any computed signals are registered.
   * @since 0.1.0
   */
  get hasComputeds(): boolean {
    return this.computeds.size > 0;
  }

  /**
   * @returns Total number of registered state and computed signals.
   * @since 0.1.0
   */
  get size(): number {
    return this.signals.size + this.computeds.size;
  }

  /** @since 0.1.0 */
  destroy(): void {
    this.signals.clear();
    this.computeds.clear();
    this.descendants.clear();
    this.minDepth = Infinity;
  }
}
