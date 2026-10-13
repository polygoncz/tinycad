import { describe, expect, it } from 'vitest';
import { DisposableStore } from './disposable';

describe('DisposableStore', () => {
  it('disposes items in reverse order of addition', () => {
    const log: string[] = [];
    const store = new DisposableStore();
    store.add({ dispose: () => log.push('a') });
    store.add(() => log.push('b'));
    store.add({ dispose: () => log.push('c') });

    store.dispose();

    expect(log).toEqual(['c', 'b', 'a']);
  });

  it('returns the added item for inline use', () => {
    const store = new DisposableStore();
    const d = { dispose: () => undefined };
    expect(store.add(d)).toBe(d);
  });

  it('is idempotent', () => {
    let count = 0;
    const store = new DisposableStore();
    store.add(() => count++);

    store.dispose();
    store.dispose();

    expect(count).toBe(1);
  });

  it('disposes an item added after dispose immediately', () => {
    let disposed = false;
    const store = new DisposableStore();
    store.dispose();

    store.add(() => (disposed = true));

    expect(disposed).toBe(true);
  });

  it('disposes the remaining items when one throws, then rethrows', () => {
    const log: string[] = [];
    const store = new DisposableStore();
    store.add(() => log.push('a'));
    store.add(() => {
      throw new Error('boom');
    });
    store.add(() => log.push('c'));

    expect(() => {
      store.dispose();
    }).toThrow('boom');
    expect(log).toEqual(['c', 'a']);
  });

  it('wraps several failures in an AggregateError', () => {
    const store = new DisposableStore();
    store.add(() => {
      throw new Error('one');
    });
    store.add(() => {
      throw new Error('two');
    });

    expect(() => {
      store.dispose();
    }).toThrow(AggregateError);
  });
});
