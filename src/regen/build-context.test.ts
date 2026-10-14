import { describe, expect, it } from 'vitest';
import type { Plane } from '@/core';
import { ORIGIN_AXIS_IDS, ORIGIN_PLANES, ORIGIN_PLANE_IDS, bodyId } from '@/document';
import type {
  AxisId,
  AxisRef,
  BodyId,
  BodyRef,
  FeatureId,
  PlaneId,
  PlaneRef,
  SketchEntityRef,
  SketchRegionRef,
  TopoName,
  TopoRef,
} from '@/document';
import type { ShapeHandle } from '@/kernel';
import { parseSketchData } from '@/sketch';
import type { SketchEntity } from '@/sketch';
import { createFakeKernel } from '@/kernel/testing';
import { createBuildSession } from './build-context';
import { nameShape } from './names';
import type { NameTable } from './names';
import { EMPTY_NAMES, EMPTY_STATE, axesOf, planesOf } from './state';
import type { Artifact, Body, RegenState } from './state';
import { aNameTable, aSketchArtifact } from './testing';

// Feature ids and handles are created by a cast in tests only: the regen state needs no real
// shapes. Body ids come from bodyId, the one place that mints them (ADR 0015).
const fid = (s: string): FeatureId => s as FeatureId;
const ref = (body: BodyId): BodyRef => ({ kind: 'body', body });
const planeRef = (plane: PlaneId): PlaneRef => ({ kind: 'plane', plane });
const bodyOf = (origin: string): BodyId => bodyId(fid(origin));

function aBody(origin: string, shape: number): Body {
  return {
    kind: 'body',
    id: bodyOf(origin),
    origin: fid(origin),
    lastModifiedBy: fid(origin),
    shape: shape as ShapeHandle,
    names: EMPTY_NAMES,
  };
}

function aState(...artifacts: Artifact[]): RegenState {
  return { artifacts: new Map(artifacts.map((a) => [a.id, a])) };
}

const regionRef = (sketch: string, region: string): SketchRegionRef => ({
  kind: 'region',
  sketch: fid(sketch),
  region,
});
const axisRef = (axis: AxisId): AxisRef => ({ kind: 'axis', axis });
const entityRef = (sketch: string, entity: string): SketchEntityRef => ({
  kind: 'sketchEntity',
  sketch: fid(sketch),
  entity,
});

/** The origin plane XZ: x = +X, y = normal × xDir = +Z (spec 12). */
function xzPlane(): Plane {
  const xz = ORIGIN_PLANES[1];
  if (xz === undefined) throw new Error('ORIGIN_PLANES has no XZ plane');
  return xz.plane;
}

/**
 * Validated sketch entities: line 'l' from (1, 2) to (1, 5), construction line 'c' from (0, 0)
 * to (3, 4), circle 'k' and the zero-length line 'z' between two points at (2, 2).
 */
function axisEntities(): readonly SketchEntity[] {
  const r = parseSketchData(
    [
      { kind: 'point', id: 'a', x: 1, y: 2 },
      { kind: 'point', id: 'b', x: 1, y: 5 },
      { kind: 'line', id: 'l', p1: 'a', p2: 'b' },
      { kind: 'point', id: 'o', x: 0, y: 0 },
      { kind: 'point', id: 'e', x: 3, y: 4 },
      { kind: 'line', id: 'c', p1: 'o', p2: 'e', construction: true },
      { kind: 'circle', id: 'k', center: 'o', radius: 2 },
      { kind: 'point', id: 'z1', x: 2, y: 2 },
      { kind: 'point', id: 'z2', x: 2, y: 2 },
      { kind: 'line', id: 'z', p1: 'z1', p2: 'z2' },
    ],
    [],
  );
  if (!r.ok) throw new Error(`invalid test sketch: ${JSON.stringify(r.error)}`);
  return r.value.entities;
}

function expectVec(actual: readonly number[] | undefined, expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((v, i) => {
    expect(actual?.[i]).toBeCloseTo(v, 12);
  });
}

function setup(state: RegenState = EMPTY_STATE) {
  const real = createFakeKernel();
  const owned = new Set<ShapeHandle>();
  return { real, owned, session: createBuildSession({ kernel: real, owned, state }) };
}

describe('createBuildSession', () => {
  it('gives the builder a tracked kernel', async () => {
    const { real, owned, session } = setup();
    expect(session.ctx.kernel).not.toBe(real);
    const { shape } = await session.ctx.kernel.makeBox({ origin: [0, 0, 0], size: [1, 1, 1] });
    expect([...owned]).toEqual([shape]);
  });

  it('gives the builder a kernel without release (Q041)', () => {
    const { session } = setup();
    // @ts-expect-error -- BuildContext.kernel is a ModelingKernel: a builder cannot release.
    expect(session.ctx.kernel.release).toBeUndefined();
  });

  it('resolves bodies of the input state in the order of refs', () => {
    const a = aBody('f1', 1);
    const b = aBody('f2', 2);
    const { session } = setup(aState(a, b));
    expect(session.ctx.resolveBodies([ref(bodyOf('f2')), ref(bodyOf('f1'))])).toEqual({
      ok: true,
      value: [b, a],
    });
  });

  it('resolves an empty list to an empty array', () => {
    const { session } = setup();
    expect(session.ctx.resolveBodies([])).toEqual({ ok: true, value: [] });
  });

  it('returns the first unresolved reference as RefError', () => {
    const { session } = setup(aState(aBody('f1', 1)));
    const missing = ref(bodyOf('f2'));
    const result = session.ctx.resolveBodies([ref(bodyOf('f1')), missing, ref(bodyOf('f3'))]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.ref).toBe(missing);
    expect(result.error.message).toMatch(/f2\/body/);
  });

  it('returns a RefError for an id under which there is an artifact of another kind', () => {
    const other = aSketchArtifact('s1');
    const { session } = setup(aState(aBody('f1', 1), other));
    // A sketch id where a body id belongs: the kind check, not the id type, rejects it.
    const notBody = ref(other.id as string as BodyId);
    const result = session.ctx.resolveBodies([ref(bodyOf('f1')), notBody]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.ref).toBe(notBody);
    expect(result.error.message).toMatch(/s1\/sketch/);
  });

  it('resolves the origin planes of EMPTY_STATE in the order of refs', () => {
    const [xy, , yz] = planesOf(EMPTY_STATE);
    const { session } = setup();
    const yzRef = planeRef(ORIGIN_PLANE_IDS.yz);
    const xyRef = planeRef(ORIGIN_PLANE_IDS.xy);
    expect(session.ctx.resolvePlanes([yzRef, xyRef])).toEqual({
      ok: true,
      value: [
        { ref: yzRef, plane: yz?.plane },
        { ref: xyRef, plane: xy?.plane },
      ],
    });
  });

  it('resolves a plane ref to the very plane of the artifact (M14: ResolvedPlane)', () => {
    const { session } = setup();
    const xzRef = planeRef(ORIGIN_PLANE_IDS.xz);
    const result = session.ctx.resolvePlanes([xzRef]);
    const artifact = EMPTY_STATE.artifacts.get(ORIGIN_PLANE_IDS.xz);
    expect(artifact?.kind).toBe('plane');
    if (!result.ok || artifact?.kind !== 'plane') return;
    expect(result.value[0]?.ref).toBe(xzRef);
    expect(result.value[0]?.plane).toBe(artifact.plane);
    expect(Object.isFrozen(result.value[0])).toBe(true);
  });

  it('resolves an empty list of planes to an empty array', () => {
    expect(setup().session.ctx.resolvePlanes([])).toEqual({ ok: true, value: [] });
  });

  it('returns the first missing plane as RefError', () => {
    const { session } = setup();
    // An id in the shape of a plane id that no artifact has.
    const missing = planeRef('origin/plane:ab' as PlaneId);
    const result = session.ctx.resolvePlanes([
      planeRef(ORIGIN_PLANE_IDS.xy),
      missing,
      planeRef('origin/plane:cd' as PlaneId),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.ref).toBe(missing);
    expect(result.error.message).toMatch(/origin\/plane:ab/);
  });

  it('returns a RefError for the id of a body given as a plane', () => {
    const { session } = setup(aState(...planesOf(EMPTY_STATE), aBody('f1', 1)));
    // A body id where a plane id belongs: the kind check, not the id shape, rejects it.
    const notPlane = planeRef(bodyOf('f1') as string as PlaneId);
    const result = session.ctx.resolvePlanes([notPlane]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.ref).toBe(notPlane);
    expect(result.error.message).toMatch(/f1\/body/);
  });

  it('resolveBodies gives a RefError for the id of a plane', () => {
    const { session } = setup();
    // A plane id where a body id belongs: the kind check rejects it.
    const notBody = ref(ORIGIN_PLANE_IDS.xy as string as BodyId);
    const result = session.ctx.resolveBodies([notBody]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.ref).toBe(notBody);
  });

  it('has no warnings when warn is not called', () => {
    expect(setup().session.warnings()).toBeUndefined();
  });

  it('joins several warnings with a newline in call order', () => {
    const { session } = setup();
    session.ctx.warn('first');
    session.ctx.warn('second');
    expect(session.warnings()).toBe('first\nsecond');
  });

  describe('resolveRegions', () => {
    const f1 = 1 as ShapeHandle;
    const f2 = 2 as ShapeHandle;
    const f3 = 3 as ShapeHandle;

    it('resolves a region to its sketch artifact and face', () => {
      const s1 = aSketchArtifact('s1', [f1, f2]);
      const { session } = setup(aState(...planesOf(EMPTY_STATE), s1));
      const r1 = regionRef('s1', 'r2');
      const result = session.ctx.resolveRegions([r1]);
      expect(result).toEqual({ ok: true, value: [{ ref: r1, sketch: s1, face: f2 }] });
      expect(result.ok && result.value[0]?.sketch).toBe(s1);
      expect(result.ok && result.value[0]?.ref).toBe(r1);
    });

    it('resolves regions of two sketches in the order of refs', () => {
      const s1 = aSketchArtifact('s1', [f1]);
      const s2 = aSketchArtifact('s2', [f2, f3]);
      const { session } = setup(aState(s1, s2));
      const a = regionRef('s2', 'r2');
      const b = regionRef('s1', 'r1');
      expect(session.ctx.resolveRegions([a, b])).toEqual({
        ok: true,
        value: [
          { ref: a, sketch: s2, face: f3 },
          { ref: b, sketch: s1, face: f1 },
        ],
      });
    });

    it('resolves an empty list to an empty array', () => {
      expect(setup().session.ctx.resolveRegions([])).toEqual({ ok: true, value: [] });
    });

    it('returns the first missing sketch as RefError', () => {
      const { session } = setup(aState(aSketchArtifact('s1', [f1])));
      const missing = regionRef('s9', 'r1');
      const result = session.ctx.resolveRegions([regionRef('s1', 'r1'), missing]);
      expect(result).toEqual({
        ok: false,
        error: { ref: missing, message: "Sketch 's9' not found" },
      });
      expect(!result.ok && result.error.ref).toBe(missing);
    });

    it('returns a missing region name as RefError', () => {
      const { session } = setup(aState(aSketchArtifact('s1', [f1])));
      const missing = regionRef('s1', 'r7');
      expect(session.ctx.resolveRegions([missing])).toEqual({
        ok: false,
        error: { ref: missing, message: "Region 'r7' of sketch 's1' not found" },
      });
    });

    it('returns a RefError when the sketch id holds an artifact of another kind', () => {
      // A body stored under the sketch id of 'f1': the kind check rejects it.
      const body = aBody('f1', 1);
      const sketchIdOfF1 = aSketchArtifact('f1').id;
      const { session } = setup({ artifacts: new Map([[sketchIdOfF1, body]]) });
      const notSketch = regionRef('f1', 'r1');
      expect(session.ctx.resolveRegions([notSketch])).toEqual({
        ok: false,
        error: { ref: notSketch, message: "Sketch 'f1' not found" },
      });
    });

    it('does not take the body of the feature for its sketch', () => {
      const { session } = setup(aState(aBody('f1', 1)));
      const r = regionRef('f1', 'r1');
      expect(session.ctx.resolveRegions([r])).toEqual({
        ok: false,
        error: { ref: r, message: "Sketch 'f1' not found" },
      });
    });
  });

  describe('resolveAxis', () => {
    function sketchOnXz(): RegenState {
      return aState(
        ...planesOf(EMPTY_STATE),
        ...axesOf(EMPTY_STATE),
        aSketchArtifact('s1', [], { plane: xzPlane(), entities: axisEntities() }),
      );
    }

    it('resolves the origin axis Z', () => {
      const { session } = setup();
      expect(session.ctx.resolveAxis(axisRef(ORIGIN_AXIS_IDS.z))).toEqual({
        ok: true,
        value: { origin: [0, 0, 0], direction: [0, 0, 1] },
      });
    });

    it('returns a missing axis as RefError', () => {
      const { session } = setup();
      // An id in the shape of an axis id that no artifact has.
      const missing = axisRef('origin/axis:w' as AxisId);
      const result = session.ctx.resolveAxis(missing);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.ref).toBe(missing);
      expect(result.error.message).toMatch(/origin\/axis:w/);
    });

    it('returns a RefError for the id of a plane given as an axis', () => {
      const { session } = setup();
      const notAxis = axisRef(ORIGIN_PLANE_IDS.xy as string as AxisId);
      const result = session.ctx.resolveAxis(notAxis);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.ref).toBe(notAxis);
      expect(result.error.message).toMatch(/origin\/plane:xy/);
    });

    it('turns a sketch line on the plane XZ into world coordinates', () => {
      const { session } = setup(sketchOnXz());
      const result = session.ctx.resolveAxis(entityRef('s1', 'l'));
      if (!result.ok) expect.fail(result.error.message);
      // (1, 2) and (1, 5) in XZ are the world points (1, 0, 2) and (1, 0, 5).
      expectVec(result.value.origin, [1, 0, 2]);
      expectVec(result.value.direction, [0, 0, 1]);
    });

    it('resolves a construction line with a unit direction', () => {
      const { session } = setup(sketchOnXz());
      const result = session.ctx.resolveAxis(entityRef('s1', 'c'));
      if (!result.ok) expect.fail(result.error.message);
      expectVec(result.value.origin, [0, 0, 0]);
      expectVec(result.value.direction, [0.6, 0, 0.8]);
    });

    it('returns a RefError for a circle', () => {
      const { session } = setup(sketchOnXz());
      const circle = entityRef('s1', 'k');
      expect(session.ctx.resolveAxis(circle)).toEqual({
        ok: false,
        error: { ref: circle, message: "Sketch entity 'k' is not a line" },
      });
    });

    it('returns a RefError for a point', () => {
      const { session } = setup(sketchOnXz());
      const point = entityRef('s1', 'a');
      expect(session.ctx.resolveAxis(point)).toEqual({
        ok: false,
        error: { ref: point, message: "Sketch entity 'a' is not a line" },
      });
    });

    it('returns a missing entity as RefError', () => {
      const { session } = setup(sketchOnXz());
      const missing = entityRef('s1', 'q');
      const result = session.ctx.resolveAxis(missing);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.ref).toBe(missing);
      expect(result.error.message).toMatch(/'q'/);
    });

    it('returns a missing sketch as RefError', () => {
      const { session } = setup(sketchOnXz());
      const missing = entityRef('s9', 'l');
      expect(session.ctx.resolveAxis(missing)).toEqual({
        ok: false,
        error: { ref: missing, message: "Sketch 's9' not found" },
      });
    });

    it('returns a RefError for a line of zero length', () => {
      const { session } = setup(sketchOnXz());
      const zero = entityRef('s1', 'z');
      const result = session.ctx.resolveAxis(zero);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.ref).toBe(zero);
      expect(result.error.message).toMatch(/zero length/);
    });
  });

  describe('resolveTopo (M14)', () => {
    const tn = (s: string): TopoName => s as TopoName;
    const topo = (origin: string, name: string): TopoRef => ({
      kind: 'topo',
      body: bodyOf(origin),
      name: tn(name),
    });
    const named = (origin: string, names: NameTable): Body => ({ ...aBody(origin, 1), names });
    const box = named(
      'b',
      aNameTable({
        faces: { 'b/face:top': [5], 'b/face:split': [2, 4] },
        edges: { 'edge:e1': [3], 'edge:twice': [7, 1] },
      }),
    );

    it('resolves a face to its body and index', () => {
      const { session } = setup(aState(box));
      const r = topo('b', 'b/face:top');
      expect(session.ctx.resolveTopo([r], 'face')).toEqual({
        ok: true,
        value: [{ ref: r, body: box, indices: [5] }],
      });
      expect(session.warnings()).toBeUndefined();
    });

    it('resolves edges in the order of refs, all indices of a name without a warning', () => {
      const { session } = setup(aState(box));
      const twice = topo('b', 'edge:twice');
      const e1 = topo('b', 'edge:e1');
      const result = session.ctx.resolveTopo([twice, e1], 'edge');
      expect(result).toEqual({
        ok: true,
        value: [
          { ref: twice, body: box, indices: [1, 7] },
          { ref: e1, body: box, indices: [3] },
        ],
      });
      expect(result.ok && Object.isFrozen(result.value[0])).toBe(true);
      expect(session.warnings()).toBeUndefined();
    });

    it('warns when a face name matches several faces and uses them all', () => {
      const { session } = setup(aState(box));
      const r = topo('b', 'b/face:split');
      const result = session.ctx.resolveTopo([r], 'face');
      expect(result.ok && result.value[0]?.indices).toEqual([2, 4]);
      expect(session.warnings()).toBe("Reference 'b/face:split' matches 2 faces; all are used");
    });

    it('looks a face name up only among faces and an edge name only among edges', () => {
      const { session } = setup(aState(box));
      const asEdge = topo('b', 'b/face:top');
      const result = session.ctx.resolveTopo([asEdge], 'edge');
      expect(result).toEqual({
        ok: false,
        error: { ref: asEdge, message: "Edge 'b/face:top' not found on body 'b/body'" },
      });
    });

    it('returns the first missing name as RefError', () => {
      const { session } = setup(aState(box));
      const missing = topo('b', 'b/face:gone');
      const result = session.ctx.resolveTopo(
        [topo('b', 'b/face:top'), missing, topo('b', 'b/face:other')],
        'face',
      );
      expect(result).toEqual({
        ok: false,
        error: { ref: missing, message: "Face 'b/face:gone' not found on body 'b/body'" },
      });
    });

    it('returns a RefError for a missing body and for an artifact of another kind', () => {
      const other = aSketchArtifact('s1');
      const { session } = setup(aState(box, other));
      const missing = topo('x', 'b/face:top');
      expect(session.ctx.resolveTopo([missing], 'face')).toEqual({
        ok: false,
        error: { ref: missing, message: "Body 'x/body' does not exist" },
      });
      const notBody: TopoRef = { ...missing, body: other.id as string as BodyId };
      expect(session.ctx.resolveTopo([notBody], 'face')).toEqual({
        ok: false,
        error: { ref: notBody, message: "'s1/sketch' is not a body" },
      });
    });

    it('resolves an empty list to an empty array', () => {
      expect(setup().session.ctx.resolveTopo([], 'edge')).toEqual({ ok: true, value: [] });
    });
  });

  describe('resolvePlanes with a face (M14)', () => {
    const tn = (s: string): TopoName => s as TopoName;

    /** The FakeKernel box [0, 10]³ of the feature 'b', named by nameShape. */
    async function boxSetup() {
      const real = createFakeKernel();
      const result = await real.makeBox({ origin: [0, 0, 0], size: [10, 10, 10] });
      const names = await nameShape({ kernel: real, featureId: fid('b'), result, inputs: [] });
      const body: Body = { ...aBody('b', 0), shape: result.shape, names };
      const owned = new Set<ShapeHandle>();
      const state = aState(...planesOf(EMPTY_STATE), body);
      return { session: createBuildSession({ kernel: real, owned, state }), body };
    }
    const face = (name: string): TopoRef => ({ kind: 'topo', body: bodyOf('b'), name: tn(name) });

    it('gives the frame of XY moved to z = 10 for the top face of the box', async () => {
      const { session } = await boxSetup();
      const top = face('b/face:top');
      const result = session.ctx.resolvePlanes([top]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [resolved] = result.value;
      expect(resolved?.ref).toBe(top);
      expectVec(resolved?.plane.origin, [0, 0, 10]);
      expectVec(resolved?.plane.xDir, [1, 0, 0]);
      expectVec(resolved?.plane.normal, [0, 0, 1]);
      expect(session.warnings()).toBeUndefined();
    });

    it('gives the frame of XZ for the front face (−Y)', async () => {
      const { session } = await boxSetup();
      const result = session.ctx.resolvePlanes([face('b/face:front')]);
      if (!result.ok) expect.fail(result.error.message);
      const plane = result.value[0]?.plane;
      const xz = xzPlane();
      expectVec(plane?.origin, xz.origin);
      expectVec(plane?.xDir, xz.xDir);
      expectVec(plane?.normal, xz.normal);
    });

    it('mixes origin planes and faces in the order of refs', async () => {
      const { session } = await boxSetup();
      const result = session.ctx.resolvePlanes([face('b/face:top'), planeRef(ORIGIN_PLANE_IDS.xz)]);
      expect(result.ok && result.value.map((r) => r.ref.kind)).toEqual(['topo', 'plane']);
    });

    it('takes the face with the smallest index and warns when the name matches several', () => {
      const names = aNameTable({
        faces: { 'b/face:split': [4, 2] },
        topology: {
          faces: [0, 1, 2, 3, 4].map((i) => ({
            surface: 'plane' as const,
            plane: { origin: [0, 0, i] as const, normal: [0, 0, 1] as const },
          })),
          edges: [],
          vertexCount: 0,
        },
      });
      const { session } = setup(aState({ ...aBody('b', 1), names }));
      const result = session.ctx.resolvePlanes([face('b/face:split')]);
      if (!result.ok) expect.fail(result.error.message);
      expectVec(result.value[0]?.plane.origin, [0, 0, 2]);
      expect(session.warnings()).toBe(
        "Reference 'b/face:split' matches 2 faces; the first is used",
      );
    });

    it('returns a RefError for a face that is not planar', () => {
      const names = aNameTable({ faces: { 'c/face:side': [0] } });
      const { session } = setup(aState({ ...aBody('b', 1), names }));
      const side = face('c/face:side');
      expect(session.ctx.resolvePlanes([side])).toEqual({
        ok: false,
        error: { ref: side, message: "Face 'c/face:side' is not planar" },
      });
    });

    it('returns a RefError for a missing name and a missing body', async () => {
      const { session } = await boxSetup();
      const gone = face('b/face:gone');
      expect(session.ctx.resolvePlanes([gone])).toEqual({
        ok: false,
        error: { ref: gone, message: "Face 'b/face:gone' not found on body 'b/body'" },
      });
      const noBody: TopoRef = { kind: 'topo', body: bodyOf('x'), name: tn('b/face:top') };
      expect(session.ctx.resolvePlanes([noBody])).toEqual({
        ok: false,
        error: { ref: noBody, message: "Body 'x/body' does not exist" },
      });
    });
  });
});
