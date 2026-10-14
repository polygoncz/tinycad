import { describe, expect, it } from 'vitest';
import { bodyId } from '@/document';
import type { BodyId, FeatureId } from '@/document';
import type { ShapeHandle } from '@/kernel';
import { EMPTY_NAMES } from '@/regen';
import type { Artifact, Body, FeatureStatus, RegenResult } from '@/regen';
import { aSketchArtifact } from '@/regen/testing';
import { createRegenStatusAdapter } from './regen-status-adapter';

// Branded ids are created by a cast at one place in tests; body ids by bodyId (ADR 0015).
const fid = (s: string): FeatureId => s as FeatureId;
const bid = (origin: string): BodyId => bodyId(fid(origin));
const handle = (n: number): ShapeHandle => n as ShapeHandle;

/** The body minted by `origin`, last modified by `lastModifiedBy` (by default its origin). */
function aBody(origin: string, shape: number, lastModifiedBy = origin): Body {
  return {
    kind: 'body',
    id: bid(origin),
    origin: fid(origin),
    lastModifiedBy: fid(lastModifiedBy),
    shape: handle(shape),
    names: EMPTY_NAMES,
  };
}

function aResult(
  statuses: readonly (readonly [string, FeatureStatus])[],
  artifacts: readonly Artifact[] = [],
): RegenResult {
  return {
    generation: 7,
    finalState: { artifacts: new Map(artifacts.map((a) => [a.id, a])) },
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
        [aBody('b', 2), aBody('a', 1)],
      ),
    );
    expect(adapter.state.get().bodies).toEqual([
      { body: bid('b'), feature: fid('b') },
      { body: bid('a'), feature: fid('a') },
    ]);
  });

  it('the feature of a body is its origin, not the feature that modified it last', () => {
    const adapter = createRegenStatusAdapter();
    adapter.publish(aResult([['a', { kind: 'ok' }]], [aBody('a', 1, 'm')]));
    expect(adapter.state.get().bodies).toEqual([{ body: bid('a'), feature: fid('a') }]);
  });

  it('leaves out artifacts that are not bodies', () => {
    const adapter = createRegenStatusAdapter();
    adapter.publish(aResult([], [aBody('a', 1), aSketchArtifact('s'), aBody('b', 2)]));
    expect(adapter.state.get().bodies.map((b) => b.body)).toEqual([bid('a'), bid('b')]);
  });

  it('grows the generation by one with every published result, whatever the Regenerator counts', () => {
    const adapter = createRegenStatusAdapter();
    adapter.publish(aResult([]));
    adapter.publish(aResult([]));
    expect(adapter.state.get().generation).toBe(2);
  });

  it('publishes a frozen snapshot with a new health map each time', () => {
    const adapter = createRegenStatusAdapter();
    adapter.publish(aResult([['a', { kind: 'ok' }]], [aBody('a', 1)]));
    const first = adapter.state.get();
    adapter.publish(aResult([['a', { kind: 'ok' }]], [aBody('a', 1)]));
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
