import { Signal } from "signal-polyfill";
import { scheduleFlush, type FlushableBinding } from "./FlushQueue";

type ValueResolver = (path: string) => unknown;

/** A binding subscribed to a path */
export type Subscriber = FlushableBinding & { subscribe(): void };

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
 * A state signal of the model. set() writes through the model, so that the data, the
 * bindings and the computeds stay in line; the registry itself sets it with apply().
 */
class PathState extends Signal.State<unknown> {
  constructor(
    value: unknown,
    private readonly path: string,
    private readonly writeThrough: (path: string, value: unknown) => void,
  ) {
    super(value, { equals: signalEquals });
  }

  override set(value: unknown): void {
    this.writeThrough(this.path, value);
  }

  apply(value: unknown): void {
    super.set(value);
  }
}

/**
 * Manages signal state and computed signals for path-based subscriptions.
 *
 * @since 0.1.0
 */
export default class SignalRegistry {
  private readonly signals = new Map<string, PathState>();
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

  /** @param writeThrough - What `set()` on a state signal does: a write through the model. */
  constructor(private readonly writeThrough: (path: string, value: unknown) => void = () => {}) {}

  /**
   * The bindings subscribed to each path. A binding on a state signal has no watcher of its
   * own: the registry writes every state signal, so it tells the bindings itself.
   */
  readonly subscribers = new Map<string, Subscriber | Subscriber[]>();

  subscribe(path: string, binding: Subscriber): void {
    const current = this.subscribers.get(path);
    if (!current) {
      this.subscribers.set(path, binding);
    } else if (Array.isArray(current)) {
      current.push(binding);
    } else {
      this.subscribers.set(path, [current, binding]);
    }
  }

  unsubscribe(path: string, binding: Subscriber): void {
    const current = this.subscribers.get(path);
    if (current === binding) {
      this.subscribers.delete(path);
    } else if (Array.isArray(current)) {
      const index = current.indexOf(binding);
      if (index !== -1) current.splice(index, 1);
      if (current.length === 0) this.subscribers.delete(path);
    }
  }

  /** Sets a state signal and, with `notify`, queues the update of the bindings on its path. */
  private write(path: string, signal: PathState, value: unknown, notify = true): void {
    const changed = notify && !signalEquals(signal.get(), value);
    signal.apply(value);
    if (!changed) return;
    const current = this.subscribers.get(path);
    if (!current) return;
    if (Array.isArray(current)) {
      for (const binding of current) scheduleFlush(binding, signal);
    } else {
      scheduleFlush(current, signal);
    }
  }

  /** Sets the state signal of `path`, if there is one, to the value the resolver returns. */
  refresh(path: string, resolver: ValueResolver): void {
    const signal = this.signals.get(path);
    if (signal) this.write(path, signal, resolver(path));
  }

  /**
   * @param path - Property path to look up or create.
   * @param initialValue - Value used when creating a new signal.
   * @returns The existing or newly created state signal.
   * @since 0.1.0
   */
  getOrCreate(path: string, initialValue: unknown): Signal.State<unknown> {
    let signal = this.signals.get(path);
    if (!signal) {
      signal = new PathState(initialValue, path, this.writeThrough);
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
      this.write(path, signal, value);
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
   * @param notify - `false` if the caller lets every binding check itself.
   * @since 0.1.0
   */
  invalidateAll(resolver: ValueResolver, notify = true): void {
    for (const [path, signal] of this.signals) {
      this.write(path, signal, resolver(path), notify);
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
    this.subscribers.clear();
    this.minDepth = Infinity;
  }
}
