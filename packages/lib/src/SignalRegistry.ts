import { Signal } from "signal-polyfill";

type ValueResolver = (path: string) => unknown;

/**
 * Custom equality that uses Object.is for primitives but always returns false
 * for objects/arrays. This ensures that parent signals fire when child properties
 * are mutated in place (the parent reference doesn't change but its contents did).
 */
function signalEquals(_a: unknown, _b: unknown): boolean {
  if (typeof _a === "object" && _a !== null) return false;
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

  /** @since 0.1.0 */
  getOrCreate(path: string, initialValue: unknown): Signal.State<unknown> {
    let signal = this.signals.get(path);
    if (!signal) {
      signal = new Signal.State(initialValue, { equals: signalEquals });
      this.signals.set(path, signal);
    }
    return signal;
  }

  /** @since 0.1.0 */
  get(path: string): Signal.State<unknown> | Signal.Computed<unknown> | undefined {
    return this.computeds.get(path) ?? this.signals.get(path);
  }

  /** @since 0.1.0 */
  has(path: string): boolean {
    return this.signals.has(path) || this.computeds.has(path);
  }

  /** @since 0.1.0 */
  set(path: string, value: unknown): void {
    const signal = this.signals.get(path);
    if (signal) {
      signal.set(value);
    }
  }

  /** @since 0.1.0 */
  invalidateChildren(parentPath: string, resolver: ValueResolver): void {
    const prefix = parentPath.endsWith("/") ? parentPath : `${parentPath}/`;
    for (const [path, signal] of this.signals) {
      if (path.startsWith(prefix)) {
        signal.set(resolver(path));
      }
    }
  }

  /** @since 0.1.0 */
  invalidateAll(resolver: ValueResolver): void {
    for (const [path, signal] of this.signals) {
      signal.set(resolver(path));
    }
  }

  /** @since 0.1.0 */
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

    const computed = new Signal.Computed(() => {
      const values = deps.map((dep) => {
        const s = this.get(dep);
        return s ? s.get() : undefined;
      });
      return fn(...values);
    });

    // Eagerly evaluate so the dependency graph is established immediately.
    // Without this, a Watcher attached to an unevaluated computed cannot
    // detect when upstream signals change (the computed has no subscriptions
    // to its dependencies until its first .get() call).
    computed.get();

    this.computeds.set(path, computed);
    return computed;
  }

  /** @since 0.1.0 */
  removeComputed(path: string): void {
    this.computeds.delete(path);
  }

  /** @since 0.1.0 */
  isComputed(path: string): boolean {
    return this.computeds.has(path);
  }

  /** @since 0.1.0 */
  get hasComputeds(): boolean {
    return this.computeds.size > 0;
  }

  /** @since 0.1.0 */
  get size(): number {
    return this.signals.size + this.computeds.size;
  }

  /** @since 0.1.0 */
  destroy(): void {
    this.signals.clear();
    this.computeds.clear();
  }
}
