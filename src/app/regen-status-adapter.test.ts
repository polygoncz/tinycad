import { describe, expect, it } from 'vitest';
import { bodyId, sketchId } from '@/document';
import type { BodyId, FeatureId, TopoName } from '@/document';
import type { ShapeHandle } from '@/kernel';
import { EMPTY_NAMES } from '@/regen';
import type { Artifact, Body, FeatureStatus, NameTable, RegenResult } from '@/regen';
import { aNameTable, aSketchArtifact } from '@/regen/testing';
import { createRegenStatusAdapter } from './regen-status-adapter';

// Branded ids are created by a cast at one place in tests; body ids by bodyId (ADR 0015).
const fid = (s: string): FeatureId => s as FeatureId;
const bid = (origin: string): BodyId => bodyId(fid(origin));
const handle = (n: number): ShapeHandle => n as ShapeHandle;
const tn = (s: string): TopoName => s as TopoName;

/** The body minted by `origin`, last modified by `lastModifiedBy` (by default its origin). */
function aBody(
  origin: string,
  shape: number,
  lastModifiedBy = origin,
  names: NameTable = EMPTY_NAMES,
): Body {
  return {
    kind: 'body',
    id: bid(origin),
    origin: fid(origin),
    lastModifiedBy: fid(lastModifiedBy),
    shape: handle(shape),
    names,
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
    expect(snapshot.sketches).toEqual([]);
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
      { body: bid('b'), feature: fid('b'), names: EMPTY_NAMES },
      { body: bid('a'), feature: fid('a'), names: EMPTY_NAMES },
    ]);
  });

  it('the feature of a body is its origin, not the feature that modified it last', () => {
    const adapter = createRegenStatusAdapter();
    adapter.publish(aResult([['a', { kind: 'ok' }]], [aBody('a', 1, 'm')]));
    expect(adapter.state.get().bodies).toEqual([
      { body: bid('a'), feature: fid('a'), names: EMPTY_NAMES },
    ]);
  });

  it('publishes the name table of each body as its names (M14)', () => {
    const adapter = createRegenStatusAdapter();
    const names = aNameTable({ faces: { 'f/face:top': [5] }, edges: { 'f/edge:a|b': [2] } });
    adapter.publish(aResult([['a', { kind: 'ok' }]], [aBody('a', 1, 'a', names)]));
    const published = adapter.state.get().bodies[0]?.names;
    expect(published).toBe(names);
    expect(published?.faces(tn('f/face:top'))).toEqual([5]);
    expect(published?.nameOfEdge(2)).toBe('f/edge:a|b');
  });

  it('leaves out artifacts that are not bodies', () => {
    const adapter = createRegenStatusAdapter();
    adapter.publish(aResult([], [aBody('a', 1), aSketchArtifact('s'), aBody('b', 2)]));
    expect(adapter.state.get().bodies.map((b) => b.body)).toEqual([bid('a'), bid('b')]);
  });

  it('lists the sketches of the final state in its order with their owner feature (M12)', () => {
    const adapter = createRegenStatusAdapter();
    adapter.publish(
      aResult([], [aSketchArtifact('s2'), aBody('a', 1), aSketchArtifact('s1', [handle(3)])]),
    );
    const { sketches } = adapter.state.get();
    expect(sketches).toEqual([
      { sketch: sketchId(fid('s2')), feature: fid('s2'), regions: [] },
      { sketch: sketchId(fid('s1')), feature: fid('s1'), regions: ['r1'] },
    ]);
    expect(Object.isFrozen(sketches)).toBe(true);
    expect(sketches.every((s) => Object.isFrozen(s))).toBe(true);
  });

  it('lists the region names of each sketch in the order of the artifact, frozen (M13)', () => {
    const adapter = createRegenStatusAdapter();
    adapter.publish(aResult([], [aSketchArtifact('s', [handle(3), handle(4), handle(5)])]));
    const regions = adapter.state.get().sketches[0]?.regions;
    expect(regions).toEqual(['r1', 'r2', 'r3']);
    expect(Object.isFrozen(regions)).toBe(true);
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
