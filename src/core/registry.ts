// Common shape for every registry keyed by type: feature schemas, op handlers,
// builders, tools (ADR 0011).
export interface Registry<T> {
  /** Duplicate key is a programmer error and throws. */
  register(item: T): void;
  /** Unknown key throws. */
  get(key: string): T;
  /** Unknown key returns undefined. */
  find(key: string): T | undefined;
  has(key: string): boolean;
  /** Snapshot in registration order. */
  all(): readonly T[];
}

export interface RegistryOptions<T> {
  /** Name used in error messages, e.g. 'feature schema'. */
  readonly what: string;
  readonly keyOf: (item: T) => string;
}

export function createRegistry<T>(opts: RegistryOptions<T>): Registry<T> {
  // Map keeps insertion order, which gives all() its registration order.
  const items = new Map<string, T>();
  return {
    register(item) {
      const key = opts.keyOf(item);
      if (items.has(key)) throw new Error(`Duplicate ${opts.what} '${key}'`);
      items.set(key, item);
    },
    get(key) {
      const item = items.get(key);
      if (item === undefined) throw new Error(`Unknown ${opts.what} '${key}'`);
      return item;
    },
    find: (key) => items.get(key),
    has: (key) => items.has(key),
    all: () => [...items.values()],
  };
}
