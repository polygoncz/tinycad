import { throwCollected } from './collect-errors';
import type { Unsubscribe } from './disposable';

interface Entry<T> {
  readonly fn: (e: T) => void;
  active: boolean;
}

// The self-referential constraint accepts both interfaces and type aliases;
// `Record<string, unknown>` would reject interfaces (they have no index signature).
export type EventMap<Events> = { [K in keyof Events]: unknown };

/** Subscribe-only view of an Emitter; what public interfaces expose (Q023). */
export interface Subscribable<Events extends EventMap<Events>> {
  on<K extends keyof Events>(type: K, fn: (e: Events[K]) => void): Unsubscribe;
  once<K extends keyof Events>(type: K, fn: (e: Events[K]) => void): Unsubscribe;
}

export class Emitter<Events extends EventMap<Events>> implements Subscribable<Events> {
  private readonly handlers = new Map<keyof Events, Entry<never>[]>();
  // Subscribe-only view handed out by public interfaces. A separate frozen object, so a
  // consumer cannot cast it back to Emitter and reach emit (Q023).
  private readonly view: Subscribable<Events> = Object.freeze({
    on: <K extends keyof Events>(type: K, fn: (e: Events[K]) => void): Unsubscribe =>
      this.on(type, fn),
    once: <K extends keyof Events>(type: K, fn: (e: Events[K]) => void): Unsubscribe =>
      this.once(type, fn),
  });

  on<K extends keyof Events>(type: K, fn: (e: Events[K]) => void): Unsubscribe {
    const entry: Entry<Events[K]> = { fn, active: true };
    this.list(type).push(entry);
    return () => {
      if (!entry.active) return;
      entry.active = false;
      const list = this.list(type);
      list.splice(list.indexOf(entry), 1);
    };
  }

  once<K extends keyof Events>(type: K, fn: (e: Events[K]) => void): Unsubscribe {
    const off = this.on(type, (e) => {
      off();
      fn(e);
    });
    return off;
  }

  emit<K extends keyof Events>(type: K, e: Events[K]): void {
    // Iterate a copy: handlers added during emit wait for the next emit.
    // The active flag skips handlers removed during emit before their turn.
    const entries = [...this.list(type)];
    const errors: unknown[] = [];
    for (const entry of entries) {
      if (!entry.active) continue;
      try {
        entry.fn(e);
      } catch (error) {
        errors.push(error);
      }
    }
    throwCollected(errors, `Several handlers of '${String(type)}' failed`);
  }

  /** View with only on/once; always the same object. */
  asSubscribable(): Subscribable<Events> {
    return this.view;
  }

  private list<K extends keyof Events>(type: K): Entry<Events[K]>[] {
    let list = this.handlers.get(type) as Entry<Events[K]>[] | undefined;
    if (!list) {
      list = [];
      this.handlers.set(type, list);
    }
    return list;
  }
}
