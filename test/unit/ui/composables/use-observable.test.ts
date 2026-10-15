import { describe, expect, it } from 'vitest';
import { effectScope, isProxy } from 'vue';
import { ObservableValue } from '@/core';
import type { Observable } from '@/core';
import { useObservable } from '@/ui/composables/use-observable';

function setup() {
  const source = new ObservableValue(1);
  let subscribers = 0;
  const observable: Observable<number> = {
    get: () => source.get(),
    subscribe: (fn) => {
      subscribers++;
      const off = source.asObservable().subscribe(fn);
      return () => {
        subscribers--;
        off();
      };
    },
  };
  return { source, observable, subscribers: () => subscribers };
}

describe('useObservable', () => {
  it('starts with the current value', () => {
    const s = setup();
    const scope = effectScope();
    const value = scope.run(() => useObservable(s.observable));
    expect(value?.value).toBe(1);
    scope.stop();
  });

  it('follows changes of the observable', () => {
    const s = setup();
    const scope = effectScope();
    const value = scope.run(() => useObservable(s.observable));
    s.source.set(2);
    expect(value?.value).toBe(2);
    scope.stop();
  });

  it('unsubscribes when the scope stops', () => {
    const s = setup();
    const scope = effectScope();
    const value = scope.run(() => useObservable(s.observable));
    expect(s.subscribers()).toBe(1);
    scope.stop();
    expect(s.subscribers()).toBe(0);
    s.source.set(3);
    expect(value?.value).toBe(1);
  });

  it('keeps the identity of the snapshot (no deep proxy)', () => {
    const snapshot = Object.freeze({ rows: Object.freeze([1, 2]) });
    const source = new ObservableValue(snapshot);
    const scope = effectScope();
    const value = scope.run(() => useObservable(source.asObservable()));
    expect(value?.value).toBe(snapshot);
    expect(value !== undefined && isProxy(value.value)).toBe(false);
    scope.stop();
  });
});
