import { describe, expect, expectTypeOf, it } from 'vitest';
import { ObservableValue, type Observable } from './observable';

describe('ObservableValue', () => {
  it('returns the current snapshot', () => {
    const o = new ObservableValue({ count: 0 });
    expect(o.get()).toEqual({ count: 0 });
  });

  it('notifies subscribers when the identity changes', () => {
    const o = new ObservableValue({ count: 0 });
    let calls = 0;
    o.subscribe(() => calls++);

    o.set({ count: 1 });

    expect(calls).toBe(1);
    expect(o.get()).toEqual({ count: 1 });
  });

  it('does not notify when the same object is set again', () => {
    const snapshot = { count: 0 };
    const o = new ObservableValue(snapshot);
    let calls = 0;
    o.subscribe(() => calls++);

    o.set(snapshot);

    expect(calls).toBe(0);
  });

  it('notifies on a structurally equal but new object (identity, not deep equality)', () => {
    const o = new ObservableValue({ count: 0 });
    let calls = 0;
    o.subscribe(() => calls++);

    o.set({ count: 0 });

    expect(calls).toBe(1);
  });

  it('uses Object.is semantics for primitives', () => {
    const o = new ObservableValue(Number.NaN);
    let calls = 0;
    o.subscribe(() => calls++);

    o.set(Number.NaN);

    expect(calls).toBe(0);
  });

  it('sees the new value inside the subscriber', () => {
    const o = new ObservableValue(1);
    let seen = 0;
    o.subscribe(() => (seen = o.get()));

    o.set(2);

    expect(seen).toBe(2);
  });

  it('stops notifying after unsubscribe', () => {
    const o = new ObservableValue(1);
    let calls = 0;
    const off = o.subscribe(() => calls++);

    off();
    o.set(2);

    expect(calls).toBe(0);
  });

  it('is usable through the read-only Observable contract', () => {
    const readOnly: Observable<string> = new ObservableValue('a');
    expect(readOnly.get()).toBe('a');
    // Consumers that get only Observable<T> cannot write.
    expectTypeOf<Observable<string>>().not.toHaveProperty('set');
  });

  describe('asObservable', () => {
    it('returns a frozen view without set', () => {
      const view = new ObservableValue(1).asObservable();
      expect('set' in view).toBe(false);
      expect(Object.isFrozen(view)).toBe(true);
    });

    it('returns the same object every time', () => {
      const o = new ObservableValue(1);
      expect(o.asObservable()).toBe(o.asObservable());
    });

    it('delegates get and subscribe to the value', () => {
      const o = new ObservableValue(1);
      const view = o.asObservable();
      let calls = 0;
      const off = view.subscribe(() => calls++);

      o.set(2);
      expect(view.get()).toBe(2);
      expect(calls).toBe(1);

      off();
      o.set(3);
      expect(calls).toBe(1);
    });
  });
});
