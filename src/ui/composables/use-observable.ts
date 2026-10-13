import { onScopeDispose, shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import type { Observable } from '@/core';

// The only bridge from presentation models to Vue reactivity (spec 11, rule 3; ADR 0010).
// shallowRef, not ref: the snapshot keeps its identity and Vue never proxies its insides
// (domain objects must not end up in reactive(), spec 11 rule 2). Read-only only in the type:
// a readonly() proxy would wrap the snapshot and break its identity.

/**
 * Reactive view of an Observable for the current effect scope (component setup or
 * effectScope). Unsubscribes when the scope stops.
 */
export function useObservable<T>(o: Observable<T>): Readonly<ShallowRef<T>> {
  const value = shallowRef(o.get());
  const off = o.subscribe(() => {
    value.value = o.get();
  });
  onScopeDispose(off);
  return value;
}
