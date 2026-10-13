import { describe, expect, it } from 'vitest';
import type { BodyId, FeatureId } from '@/document';
import type { ShapeHandle } from '@/kernel';
import { EMPTY_NAMES } from '@/regen';
import type { Body, FeatureStatus, RegenResult } from '@/regen';
import { createRegenStatusAdapter } from './regen-status-adapter';

// Branded ids are created by a cast at one place in tests.
const fid = (s: string): FeatureId => s as FeatureId;
const bid = (s: string): BodyId => s as BodyId;
const handle = (n: number): ShapeHandle => n as ShapeHandle;

function aBody(id: string, feature: string, shape: number): Body {
  return { id: bid(id), shape: handle(shape), createdBy: fid(feature), names: EMPTY_NAMES };
}

function aResult(
  statuses: readonly (readonly [string, FeatureStatus])[],
  bodies: readonly Body[] = [],
): RegenResult {
  return {
    generation: 7,
    finalState: { bodies: new Map(bodies.map((b) => [b.id, b])) },
    statuses: new Map(statuses.map(([id, s]) => [fid(id), s])),
    durationMs: 3,
  };
}

describe('RegenStatusAdapter', () => {
  it('starts with no regeneration', () => {
    const adapter = createRegenStatusAdapter();
    const snapshot = adapter.state.get();
    expect(snapshot.generation).toBe(0);
    expect(snapshot.health.size).toBe(0);
    expect(snapshot.bodies).toEqual([]);
  });

  it('maps the statuses of evaluated features to health and leaves the others out', () => {
    const adapter = createRegenStatusAdapter();
    adapter.publish(
      aResult([
        ['a', { kind: 'ok' }],
        ['b', { kind: 'warning', message: 'careful' }],
        ['c', { kind: 'error', error: { code: 'KERNEL', message: 'failed' } }],
        ['d', { kind: 'suppressed' }],
        ['e', { kind: 'rolledBack' }],
      ]),
    );
    const { health } = adapter.state.get();
    expect([...health.keys()]).toEqual([fid('a'), fid('b'), fid('c')]);
    expect(health.get(fid('a'))).toEqual({ kind: 'ok' });
    expect(health.get(fid('b'))).toEqual({ kind: 'warning', message: 'careful' });
    expect(health.get(fid('c'))).toEqual({ kind: 'error', message: 'failed' });
  });

  it('passes the issues of invalid params on', () => {
    const adapter = createRegenStatusAdapter();
    const issues = Object.freeze([
      Object.freeze({ param: 'height', code: 'param.atOrBelowMin', params: { min: 0 } }),
    ]);
    adapter.publish(
      aResult([
        ['a', { kind: 'error', error: { code: 'INVALID_PARAMS', message: 'height', issues } }],
      ]),
    );
    expect(adapter.state.get().health.get(fid('a'))).toEqual({
      kind: 'error',
      message: 'height',
      issues: [{ param: 'height', code: 'param.atOrBelowMin', params: { min: 0 } }],
    });
  });

  it('lists the bodies of the final state in its order with the feature that made them', () => {
    const adapter = createRegenStatusAdapter();
    adapter.publish(
      aResult(
        [
          ['a', { kind: 'ok' }],
          ['b', { kind: 'ok' }],
        ],
        [aBody('b/body', 'b', 2), aBody('a/body', 'a', 1)],
      ),
    );
    expect(adapter.state.get().bodies).toEqual([
      { body: bid('b/body'), feature: fid('b') },
      { body: bid('a/body'), feature: fid('a') },
    ]);
  });

  it('grows the generation by one with every published result, whatever the Regenerator counts', () => {
    const adapter = createRegenStatusAdapter();
    adapter.publish(aResult([]));
    adapter.publish(aResult([]));
    expect(adapter.state.get().generation).toBe(2);
  });

  it('publishes a frozen snapshot with a new health map each time', () => {
    const adapter = createRegenStatusAdapter();
    adapter.publish(aResult([['a', { kind: 'ok' }]], [aBody('a/body', 'a', 1)]));
    const first = adapter.state.get();
    adapter.publish(aResult([['a', { kind: 'ok' }]], [aBody('a/body', 'a', 1)]));
    const second = adapter.state.get();
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(second.bodies)).toBe(true);
    expect(second.bodies.every((b) => Object.isFrozen(b))).toBe(true);
    expect([...second.health.values()].every((h) => Object.isFrozen(h))).toBe(true);
    expect(second.health).not.toBe(first.health);
  });

  it('notifies subscribers on publish', () => {
    const adapter = createRegenStatusAdapter();
    let calls = 0;
    adapter.state.subscribe(() => calls++);
    adapter.publish(aResult([]));
    expect(calls).toBe(1);
  });
});
