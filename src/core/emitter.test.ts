import { describe, expect, expectTypeOf, it } from 'vitest';
import { Emitter } from './emitter';
import type { Subscribable } from './emitter';

// An interface on purpose: the Events constraint must accept interfaces, not only type aliases.
interface TestEvents {
  change: { value: number };
  reset: undefined;
}

describe('Emitter', () => {
  it('calls handlers synchronously in registration order', () => {
    const e = new Emitter<TestEvents>();
    const log: string[] = [];
    e.on('change', (ev) => log.push(`a${String(ev.value)}`));
    e.on('change', (ev) => log.push(`b${String(ev.value)}`));

    e.emit('change', { value: 1 });

    expect(log).toEqual(['a1', 'b1']);
  });

  it('only calls handlers of the emitted type', () => {
    const e = new Emitter<TestEvents>();
    let changes = 0;
    e.on('change', () => changes++);

    e.emit('reset', undefined);

    expect(changes).toBe(0);
  });

  it('stops calling a handler after unsubscribe', () => {
    const e = new Emitter<TestEvents>();
    let count = 0;
    const off = e.on('reset', () => count++);

    e.emit('reset', undefined);
    off();
    off(); // idempotent
    e.emit('reset', undefined);

    expect(count).toBe(1);
  });

  it('once handler runs a single time', () => {
    const e = new Emitter<TestEvents>();
    let count = 0;
    e.once('reset', () => count++);

    e.emit('reset', undefined);
    e.emit('reset', undefined);

    expect(count).toBe(1);
  });

  it('once handler can be unsubscribed before it fires', () => {
    const e = new Emitter<TestEvents>();
    let count = 0;
    const off = e.once('reset', () => count++);

    off();
    e.emit('reset', undefined);

    expect(count).toBe(0);
  });

  it('does not call a handler unsubscribed during emit by an earlier handler', () => {
    const e = new Emitter<TestEvents>();
    const log: string[] = [];
    e.on('reset', () => {
      log.push('a');
      offB();
    });
    const offB = e.on('reset', () => log.push('b'));

    e.emit('reset', undefined);

    expect(log).toEqual(['a']);
  });

  it('lets a handler unsubscribe itself during emit without skipping the next one', () => {
    const e = new Emitter<TestEvents>();
    const log: string[] = [];
    const offA = e.on('reset', () => {
      log.push('a');
      offA();
    });
    e.on('reset', () => log.push('b'));

    e.emit('reset', undefined);
    e.emit('reset', undefined);

    expect(log).toEqual(['a', 'b', 'b']);
  });

  it('calls a handler added during emit only on the next emit', () => {
    const e = new Emitter<TestEvents>();
    const log: string[] = [];
    e.once('reset', () => {
      log.push('a');
      e.on('reset', () => log.push('late'));
    });

    e.emit('reset', undefined);
    expect(log).toEqual(['a']);

    e.emit('reset', undefined);
    expect(log).toEqual(['a', 'late']);
  });

  it('runs all handlers when one throws, then rethrows the error', () => {
    const e = new Emitter<TestEvents>();
    const log: string[] = [];
    e.on('reset', () => {
      throw new Error('boom');
    });
    e.on('reset', () => log.push('b'));

    expect(() => {
      e.emit('reset', undefined);
    }).toThrow('boom');
    expect(log).toEqual(['b']);
  });

  it('wraps several handler errors in an AggregateError', () => {
    const e = new Emitter<TestEvents>();
    e.on('reset', () => {
      throw new Error('one');
    });
    e.on('reset', () => {
      throw new Error('two');
    });

    expect(() => {
      e.emit('reset', undefined);
    }).toThrow(AggregateError);
  });
});

describe('Subscribable', () => {
  it('is implemented by Emitter but hides emit', () => {
    const e = new Emitter<TestEvents>();
    const events: Subscribable<TestEvents> = e;
    const seen: number[] = [];
    events.on('change', ({ value }) => seen.push(value));
    e.emit('change', { value: 1 });
    expect(seen).toEqual([1]);
    expectTypeOf<Subscribable<TestEvents>>().not.toHaveProperty('emit');
  });
});
