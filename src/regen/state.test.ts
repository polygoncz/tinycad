import { describe, expect, it } from 'vitest';
import { ORIGIN, ORIGIN_PLANES, ORIGIN_PLANE_IDS, bodyId } from '@/document';
import type { FeatureId } from '@/document';
import type { ShapeHandle } from '@/kernel';
import { EMPTY_NAMES, EMPTY_STATE, bodiesOf, planesOf, sketchesOf } from './state';
import type { Artifact, Body, RegenState } from './state';
import { aSketchArtifact } from './testing';

// Feature ids and handles are created by a cast in tests only: the state needs no real shapes.
const fid = (s: string): FeatureId => s as FeatureId;

function aBody(origin: string, shape: number): Body {
  return {
    kind: 'body',
    id: bodyId(fid(origin)),
    origin: fid(origin),
    lastModifiedBy: fid(origin),
    shape: shape as ShapeHandle,
    names: EMPTY_NAMES,
  };
}

function aState(...artifacts: Artifact[]): RegenState {
  return { artifacts: new Map(artifacts.map((x) => [x.id, x])) };
}

describe('EMPTY_STATE', () => {
  it('holds the three origin planes in the order xy, xz, yz', () => {
    expect([...EMPTY_STATE.artifacts.keys()]).toEqual([
      ORIGIN_PLANE_IDS.xy,
      ORIGIN_PLANE_IDS.xz,
      ORIGIN_PLANE_IDS.yz,
    ]);
  });

  it('gives each origin plane the frame of ORIGIN_PLANES and the owner ORIGIN', () => {
    expect([...EMPTY_STATE.artifacts.values()]).toEqual(
      ORIGIN_PLANES.map(({ id, plane }) => ({ kind: 'plane', id, owner: ORIGIN, plane })),
    );
  });

  it('has the frames of spec 12: XY normal +Z, XZ normal -Y, YZ x +Y and normal +X', () => {
    const [xy, xz, yz] = planesOf(EMPTY_STATE);
    expect(xy?.plane).toEqual({ origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] });
    expect(xz?.plane).toEqual({ origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] });
    expect(yz?.plane).toEqual({ origin: [0, 0, 0], xDir: [0, 1, 0], normal: [1, 0, 0] });
  });

  it('is frozen, its plane artifacts deeply', () => {
    expect(Object.isFrozen(EMPTY_STATE)).toBe(true);
    for (const artifact of planesOf(EMPTY_STATE)) {
      expect(Object.isFrozen(artifact)).toBe(true);
      expect(Object.isFrozen(artifact.plane)).toBe(true);
      expect(Object.isFrozen(artifact.plane.origin)).toBe(true);
      expect(Object.isFrozen(artifact.plane.xDir)).toBe(true);
      expect(Object.isFrozen(artifact.plane.normal)).toBe(true);
    }
  });

  it('has no bodies and no sketches', () => {
    expect(bodiesOf(EMPTY_STATE)).toEqual([]);
    expect(sketchesOf(EMPTY_STATE)).toEqual([]);
  });
});

describe('bodiesOf', () => {
  it('gives no bodies for EMPTY_STATE', () => {
    expect(bodiesOf(EMPTY_STATE)).toEqual([]);
  });

  it('gives the bodies in the order of the map', () => {
    const a = aBody('a', 1);
    const b = aBody('b', 2);
    const state: RegenState = { artifacts: new Map([b, a].map((x) => [x.id, x])) };
    expect(bodiesOf(state)).toEqual([b, a]);
    expect(bodiesOf(state)[0]).toBe(b);
  });

  it('leaves out planes and sketches', () => {
    const a = aBody('a', 1);
    const b = aBody('b', 2);
    const [xy] = planesOf(EMPTY_STATE);
    if (xy === undefined) expect.fail('EMPTY_STATE has no planes');
    const state = aState(xy, a, aSketchArtifact('s', [3 as ShapeHandle]), b);
    expect(bodiesOf(state)).toEqual([a, b]);
  });
});

describe('sketchesOf', () => {
  it('gives the sketches in the order of the map and leaves out bodies and planes', () => {
    const s2 = aSketchArtifact('s2');
    const s1 = aSketchArtifact('s1', [1 as ShapeHandle]);
    const state = aState(...planesOf(EMPTY_STATE), s2, aBody('a', 2), s1);
    expect(sketchesOf(state)).toEqual([s2, s1]);
    expect(sketchesOf(state)[0]).toBe(s2);
  });
});

describe('planesOf', () => {
  it('gives the planes in the order of the map and leaves out bodies and sketches', () => {
    const [xy, xz, yz] = planesOf(EMPTY_STATE);
    if (xy === undefined || xz === undefined || yz === undefined) {
      expect.fail('EMPTY_STATE has not three planes');
    }
    const state = aState(yz, aBody('a', 1), aSketchArtifact('s'), xy);
    expect(planesOf(state)).toEqual([yz, xy]);
    expect(planesOf(state)[0]).toBe(yz);
  });
});

describe('EMPTY_NAMES', () => {
  it('is empty and frozen', () => {
    expect(Object.keys(EMPTY_NAMES)).toEqual([]);
    expect(Object.isFrozen(EMPTY_NAMES)).toBe(true);
  });
});
