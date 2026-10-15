import { describe, expect, it } from 'vitest';
import type { BodyId, FeatureId } from '@/document';
import { nameOfHit } from '@/interaction/regen-status-port';
import { FakeRegenStatus, aTopoNames } from '@/interaction/testing';

// The name of a hit face or edge in the last snapshot (M14): the one lookup shared by the
// reference pick, the selection and the TopoInspector.

const B1 = 'f1/body' as BodyId; // test ids are trusted
const B2 = 'f2/body' as BodyId;
const F1 = 'f1' as FeatureId;
const F2 = 'f2' as FeatureId;

function aSnapshot() {
  const regen = new FakeRegenStatus();
  regen.publish(new Map(), [
    {
      body: B1,
      feature: F1,
      names: aTopoNames({ faces: { 'f1/face:top': [5] }, edges: { 'f1/edge:a|b': [3] } }),
    },
    { body: B2, feature: F2 },
  ]);
  return regen.state.get();
}

describe('nameOfHit', () => {
  it('names a face and an edge of a body of the snapshot', () => {
    const snapshot = aSnapshot();
    expect(nameOfHit(snapshot, B1, 'face', 5)).toBe('f1/face:top');
    expect(nameOfHit(snapshot, B1, 'edge', 3)).toBe('f1/edge:a|b');
  });

  it('does not mix faces and edges', () => {
    const snapshot = aSnapshot();
    expect(nameOfHit(snapshot, B1, 'edge', 5)).toBeUndefined();
    expect(nameOfHit(snapshot, B1, 'face', 3)).toBeUndefined();
  });

  it('is undefined for an index without a name, a body without names and a body not there', () => {
    const snapshot = aSnapshot();
    expect(nameOfHit(snapshot, B1, 'face', 0)).toBeUndefined();
    expect(nameOfHit(snapshot, B2, 'face', 5)).toBeUndefined();
    expect(nameOfHit(snapshot, 'f3/body' as BodyId, 'face', 5)).toBeUndefined();
  });
});

describe('nameOfHit – pickable bodies (M21, ADR 0025)', () => {
  it('reads the names of snapshot.pick, not of the final bodies', () => {
    const regen = new FakeRegenStatus();
    regen.publish(
      new Map(),
      [{ body: B1, feature: F1, names: aTopoNames({ edges: { 'f1/edge:result': [3] } }) }],
      [],
      new Map(),
      {
        feature: F2,
        bodies: [{ body: B1, feature: F1, names: aTopoNames({ edges: { 'f1/edge:input': [3] } }) }],
      },
    );
    expect(nameOfHit(regen.state.get(), B1, 'edge', 3)).toBe('f1/edge:input');
  });

  it('a body only in the final bodies has no name', () => {
    const regen = new FakeRegenStatus();
    regen.publish(
      new Map(),
      [{ body: B1, feature: F1, names: aTopoNames({ faces: { 'f1/face:top': [5] } }) }],
      [],
      new Map(),
      { feature: F2, bodies: [] },
    );
    expect(nameOfHit(regen.state.get(), B1, 'face', 5)).toBeUndefined();
  });
});
