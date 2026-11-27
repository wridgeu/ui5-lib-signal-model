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

/** See SignalRegistry.signalReplaced() */
const REPLACED = {};

/**
 * Manages signal state and computed signals for path-based subscriptions.
 *
 * @since 0.1.0
 */
export default class SignalRegistry {
  private readonly signals = new Map<string, PathState>();
  private readonly computeds = new Map<string, Signal.Computed<unknown>>();
  /** Paths whose computed was removed: a new computed may take the place of their state signal. */
  private readonly released = new Set<string>();
  /**
   * For a path that holds or held a computed, and only once another computed depends on it
   * or on a path below it: a signal that is set when a computed is created or removed
   * there. Those computeds read it, so they run again and find the other signal.
   */
  private readonly replaced = new Map<string, Signal.State<number>>();
  /**
   * Paths of the state signals below each path, filled as signals are created. Lets a
   * write reach its child signals directly instead of scanning the whole registry.
   */
  private readonly descendants = new Map<string, string[]>();
  /**
   * State signals that stay without a binding: someone outside holds them (getSignal) or a
   * computed reads them. Any other state signal goes with its last binding.
   */
  private readonly pinned = new Map<string, number>();
  /** Paths of dropped state signals that the index still lists, until the next sweep. */
  private readonly dropped = new Set<string>();
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
    if (!this.subscribers.has(path) && !this.pinned.has(path)) this.drop(path);
  }

  /** Removes the state signal of `path`. Its index entries go with a later sweep. */
  private drop(path: string): void {
    if (!this.signals.delete(path)) return;
    // The last binding has left a path whose computed was removed: a path like any other
    if (!this.replaced.has(path)) this.released.delete(path);
    this.dropped.add(path);
    // Amortised: a sweep visits every index entry, so only once half of them are stale
    if (this.dropped.size <= this.signals.size + 64) return;
    for (const [ancestor, below] of this.descendants) {
      const kept = below.filter((entry) => !this.dropped.has(entry));
      if (kept.length === 0) {
        this.descendants.delete(ancestor);
      } else if (kept.length < below.length) {
        this.descendants.set(ancestor, kept);
      }
    }
    this.dropped.clear();
  }

  /** Sets a state signal and, with `notify`, queues the update of the bindings on its path. */
  private write(
    path: string,
    signal: PathState,
    value: unknown,
    notify = true,
    force = false,
  ): void {
    const changed = notify && (force || !signalEquals(signal.get(), value));
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

  /**
   * Sets the state signal of `path`, if there is one, to the value the resolver returns.
   * With `force` its bindings are told also when the signal already holds that value: a
   * binding may show another one.
   */
  refresh(path: string, resolver: ValueResolver, force = false): void {
    const signal = this.signals.get(path);
    if (signal) this.write(path, signal, resolver(path), true, force);
  }

  /** Whether something is kept for a computed that `path` holds or held. */
  remembers(path: string): boolean {
    return this.released.has(path) || this.replaced.has(path);
  }

  /**
   * No computed reads `path` or a path below it any more: what was kept to tell them about
   * a computed created or removed there goes. That the path held a computed is kept as long
   * as a binding is on it, so that a computed can be created there again.
   */
  forget(path: string): void {
    if (this.computeds.has(path)) return;
    this.replaced.delete(path);
    if (!this.signals.has(path) && !this.subscribers.has(path)) this.released.delete(path);
  }

  /** Drops the state signal of `path` if nothing holds it: no pin and no binding. */
  release(path: string): void {
    if (!this.pinned.has(path) && !this.subscribers.has(path)) this.drop(path);
  }

  /** Takes one pin back: without any left, the state signal goes with its last binding. */
  unpin(path: string): void {
    const pins = (this.pinned.get(path) ?? 0) - 1;
    if (pins > 0) {
      this.pinned.set(path, pins);
      return;
    }
    this.pinned.delete(path);
    if (!this.subscribers.has(path)) this.drop(path);
  }

  /**
   * For data changed without the model: sets the state signals at `path` and below it to the
   * values the resolver returns. An object that is still the same object is no change here.
   */
  sync(path: string, resolver: ValueResolver): void {
    const paths =
      path === "/" ? this.signals.keys() : [path, ...(this.descendants.get(path) ?? [])];
    for (const each of paths) {
      const signal = this.signals.get(each);
      if (!signal) continue;
      const value = resolver(each);
      // Not written at all: a write of an object makes the computeds that read it run again
      if (!Object.is(signal.get(), value)) this.write(each, signal, value);
    }
  }

  /**
   * @param path - Property path to look up or create.
   * @param initialValue - Value used when creating a new signal.
   * @param pin - Whether the signal stays when no binding is on its path.
   * @returns The existing or newly created state signal.
   * @since 0.1.0
   */
  getOrCreate(path: string, initialValue: unknown, pin = false): Signal.State<unknown> {
    if (pin) this.pinned.set(path, (this.pinned.get(path) ?? 0) + 1);
    let signal = this.signals.get(path);
    if (!signal) {
      signal = new PathState(initialValue, path, this.writeThrough);
      this.signals.set(path, signal);
      // Dropped and not swept yet: the index still lists the path
      const indexed = this.dropped.delete(path);
      let depth = path === "/" ? 0 : 1;
      for (let idx = path.lastIndexOf("/"); idx > 0; idx = path.lastIndexOf("/", idx - 1)) {
        depth++;
        if (indexed) continue;
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

  /** @returns The computed at exactly `path`, if there is one. */
  getComputed(path: string): Signal.Computed<unknown> | undefined {
    return this.computeds.get(path);
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
        this.refresh(path, resolver);
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
    read?: ValueResolver,
  ): Signal.Computed<unknown> {
    if (this.signals.has(path) && !this.released.has(path)) {
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
      () => fn(...deps.map((dep) => this.readDependency(dep, read))),
      { equals: signalEquals },
    );

    // Eagerly evaluate so the dependency graph is established immediately.
    // Without this, a Watcher attached to an unevaluated computed cannot
    // detect when upstream signals change (the computed has no subscriptions
    // to its dependencies until its first .get() call).
    // If it throws, nothing has changed.
    computed.get();

    // The state signal the bindings went to when the computed was removed
    this.pinned.delete(path);
    this.drop(path);
    this.released.delete(path);
    this.computeds.set(path, computed);
    this.signalReplaced(path, read);
    return computed;
  }

  /**
   * @param path - Property path of the computed signal to remove.
   * @since 0.1.0
   */
  removeComputed(path: string, read?: ValueResolver): boolean {
    if (!this.computeds.delete(path)) return false;
    this.released.add(path);
    // What a computed that depends on the path follows from now on. Created first: such a
    // computed may run again while the signals below are set.
    // Not pinned here: the model pins it for each computed that reads exactly this path.
    if (this.replaced.has(path)) this.getOrCreate(path, read?.(path));
    this.signalReplaced(path, read);
    return true;
  }

  /**
   * The value of a dependency of a computed: of the closest computed at or above the path
   * (with `read` for a path inside its value), otherwise of the path's state signal.
   */
  private readDependency(dep: string, read: ValueResolver | undefined): unknown {
    for (let at = dep; ;) {
      const computed = this.computeds.get(at);
      if (computed || this.released.has(at)) {
        let replaced = this.replaced.get(at);
        if (!replaced) this.replaced.set(at, (replaced = new Signal.State(0)));
        replaced.get();
        if (computed && at === dep) return computed.get();
        // read() goes through the computed, which makes it a dependency
        if (computed && read) return read(dep);
      }
      const idx = at.lastIndexOf("/");
      if (idx <= 0) break;
      at = at.substring(0, idx);
    }
    return this.signals.get(dep)?.get();
  }

  /** Makes the computeds run again that read `path` or a path below it. */
  private signalReplaced(path: string, read: ValueResolver | undefined): void {
    const replaced = this.replaced.get(path);
    replaced?.set(replaced.get() + 1);
    // A computed may have read a state signal below the path. Set even to an equal value,
    // such a signal would not tell it: hence the object in between.
    for (const below of this.descendants.get(path) ?? []) {
      const signal = this.signals.get(below);
      if (!signal) continue;
      const value = read ? read(below) : signal.get();
      signal.apply(REPLACED);
      signal.apply(value);
    }
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
    this.released.clear();
    this.replaced.clear();
    this.descendants.clear();
    this.pinned.clear();
    this.dropped.clear();
    this.subscribers.clear();
    this.minDepth = Infinity;
  }
}
