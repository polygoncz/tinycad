import { describe, expect, it } from 'vitest';
import { plane, vec3 } from '@/core';
import type { Vec3 } from '@/core';
import { ORIGIN_PLANE_IDS, bodyId } from '@/document';
import type { BodyId, FeatureId, PlaneId, PlaneRef, TopoName, TopoRef } from '@/document';
import type { FacePlane, ShapeHandle } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { planeOfRef, sketchPlaneOfFace } from './face-plane';
import { nameShape } from './names';
import { EMPTY_STATE, planesOf } from './state';
import type { Body, RegenState } from './state';
import { aNameTable } from './testing';

// Feature ids and names are created by a cast in tests only.
const fid = (s: string): FeatureId => s as FeatureId;
const tn = (s: string): TopoName => s as TopoName;
const topoRef = (body: BodyId, name: string): TopoRef => ({ kind: 'topo', body, name: tn(name) });
const planeRef = (id: PlaneId): PlaneRef => ({ kind: 'plane', plane: id });

function expectVec(actual: Vec3, expected: Vec3): void {
  expect(vec3.equals(actual, expected, 1e-12)).toBe(true);
}

describe('sketchPlaneOfFace', () => {
  it('gives the frame of XY moved up for a face with the normal +Z', () => {
    const p = sketchPlaneOfFace({ origin: [5, 5, 10], normal: [0, 0, 1] });
    expectVec(p.origin, [0, 0, 10]);
    expectVec(p.xDir, [1, 0, 0]);
    expectVec(p.normal, [0, 0, 1]);
  });

  it('gives xDir +X for the normal −Z', () => {
    const p = sketchPlaneOfFace({ origin: [3, 4, 2], normal: [0, 0, -1] });
    expectVec(p.origin, [0, 0, 2]);
    expectVec(p.xDir, [1, 0, 0]);
    expectVec(p.normal, [0, 0, -1]);
  });

  it('gives the frame of XZ for a face with the normal −Y', () => {
    const p = sketchPlaneOfFace({ origin: [5, -3, 5], normal: [0, -1, 0] });
    expectVec(p.origin, [0, -3, 0]);
    expectVec(p.xDir, [1, 0, 0]);
    expectVec(p.normal, [0, -1, 0]);
    // Up in the sketch is +Z, like on the origin plane XZ (spec 12).
    expectVec(plane.yDir(p), [0, 0, 1]);
  });

  it('gives xDir +X for the normal +Y', () => {
    const p = sketchPlaneOfFace({ origin: [1, 7, 1], normal: [0, 1, 0] });
    expectVec(p.origin, [0, 7, 0]);
    expectVec(p.xDir, [1, 0, 0]);
  });

  it.each([
    [[1, 0, 0], 4],
    [[-1, 0, 0], -4],
  ] as const)('takes +Y as xDir for the normal %j (|n·X| ≥ 0.9)', (normal, x) => {
    const p = sketchPlaneOfFace({ origin: [x, 2, 3], normal });
    expectVec(p.origin, [x, 0, 0]);
    expectVec(p.xDir, [0, 1, 0]);
    expectVec(p.normal, normal);
  });

  it('gives an orthonormal frame on the face for an oblique normal', () => {
    const face: FacePlane = { origin: [1, 2, 3], normal: vec3.normalize([1, 1, 1]) };
    const p = sketchPlaneOfFace(face);
    expect(plane.isOrthonormal(p)).toBe(true);
    // The origin lies on the face plane and is the projection of the world origin.
    expect(vec3.dot(vec3.sub(p.origin, face.origin), face.normal)).toBeCloseTo(0, 12);
    expect(vec3.length(vec3.cross(p.origin, face.normal))).toBeCloseTo(0, 12);
    // xDir is the projection of +X: no component along −X.
    expect(p.xDir[0]).toBeGreaterThan(0);
    expect(p.xDir[1]).toBeCloseTo(p.xDir[2], 12);
  });

  it('normalises a normal that is not unit length', () => {
    const p = sketchPlaneOfFace({ origin: [0, 0, 5], normal: [0, 0, 3] });
    expectVec(p.normal, [0, 0, 1]);
    expectVec(p.origin, [0, 0, 5]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(sketchPlaneOfFace({ origin: [0, 0, 0], normal: [0, 0, 1] }))).toBe(true);
  });
});

describe('planeOfRef', () => {
  async function boxState(): Promise<RegenState> {
    const kernel = createFakeKernel();
    const result = await kernel.makeBox({ origin: [0, 0, 0], size: [10, 10, 10] });
    const names = await nameShape({ kernel, featureId: fid('b'), result, inputs: [] });
    const body: Body = {
      kind: 'body',
      id: bodyId(fid('b')),
      origin: fid('b'),
      lastModifiedBy: fid('b'),
      shape: result.shape,
      names,
    };
    return { artifacts: new Map(EMPTY_STATE.artifacts).set(body.id, body) };
  }

  it('gives the plane of an origin plane artifact', () => {
    const [, xz] = planesOf(EMPTY_STATE);
    expect(planeOfRef(EMPTY_STATE, planeRef(ORIGIN_PLANE_IDS.xz))).toBe(xz?.plane);
  });

  it('gives undefined for a missing plane', () => {
    expect(planeOfRef(EMPTY_STATE, planeRef('origin/plane:ab' as PlaneId))).toBeUndefined();
  });

  it('gives the frame of the top face of a box', async () => {
    const p = planeOfRef(await boxState(), topoRef(bodyId(fid('b')), 'b/face:top'));
    expect(p).toBeDefined();
    if (p === undefined) return;
    expectVec(p.origin, [0, 0, 10]);
    expectVec(p.xDir, [1, 0, 0]);
    expectVec(p.normal, [0, 0, 1]);
  });

  it('gives undefined for a missing body, a missing name and a non-planar face', async () => {
    const state = await boxState();
    expect(planeOfRef(state, topoRef(bodyId(fid('x')), 'b/face:top'))).toBeUndefined();
    expect(planeOfRef(state, topoRef(bodyId(fid('b')), 'b/face:none'))).toBeUndefined();

    const curved: Body = {
      kind: 'body',
      id: bodyId(fid('c')),
      origin: fid('c'),
      lastModifiedBy: fid('c'),
      shape: 1 as ShapeHandle,
      names: aNameTable({ faces: { 'c/face:side': [0] } }),
    };
    const withCurved: RegenState = { artifacts: new Map(state.artifacts).set(curved.id, curved) };
    expect(planeOfRef(withCurved, topoRef(curved.id, 'c/face:side'))).toBeUndefined();
  });

  it('gives undefined for a topo ref whose body id names an artifact of another kind', () => {
    const notBody = ORIGIN_PLANE_IDS.xy as string as BodyId;
    expect(planeOfRef(EMPTY_STATE, topoRef(notBody, 'b/face:top'))).toBeUndefined();
  });
});
