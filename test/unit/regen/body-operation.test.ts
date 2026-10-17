import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import { ORIGIN_PLANE_IDS, bodyId } from '@/document';
import type { BodyId, FeatureId, TopoName } from '@/document';
import { kernelErrorCode } from '@/kernel';
import type { BooleanOp, ShapeHandle, ShapeResult } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { applyBodyOperation } from '@/regen/body-operation';
import type { ModelingKernel } from '@/regen/builder';
import { nameShape } from '@/regen/names';
import type { NameTable } from '@/regen/names';
import { EMPTY_STATE, bodiesOf } from '@/regen/state';
import type { Artifact, ArtifactId, Body, RegenState } from '@/regen/state';
import { aSketchArtifact } from '@/regen/testing';

// The body operation of Extrude and Revolve (spec 07, Operace tělesa): identity of the new or
// changed bodies, order of the map, the boolean calls made, the names (M14).

// Feature ids are plain strings in tests; bodyId mints the body ids like in a builder.
const fid = (s: string): FeatureId => s as FeatureId;
const FEATURE = fid('e1');
const tn = (s: string): TopoName => s as TopoName;

interface BooleanCall {
  readonly op: BooleanOp;
  readonly targets: readonly ShapeHandle[];
  readonly tools: readonly ShapeHandle[];
}

/** A ModelingKernel over a FakeKernel that records every boolean call. */
function aRecordingKernel() {
  const fake = createFakeKernel();
  const calls: BooleanCall[] = [];
  const kernel: ModelingKernel = {
    makeBox: (p) => fake.makeBox(p),
    makeCylinder: (p) => fake.makeCylinder(p),
    transform: (shape, m) => fake.transform(shape, m),
    boolean(op, targets, tools) {
      calls.push({ op, targets: [...targets], tools: [...tools] });
      return fake.boolean(op, targets, tools);
    },
    makeFace: (p) => fake.makeFace(p),
    profileRegions: (p) => fake.profileRegions(p),
    curveIntersections: (p) => fake.curveIntersections(p),
    curveSegment: (p) => fake.curveSegment(p),
    filletArc: (p) => fake.filletArc(p),
    offsetCurves: (p) => fake.offsetCurves(p),
    extrude: (profile, direction, distance) => fake.extrude(profile, direction, distance),
    revolve: (profile, axis, angle) => fake.revolve(profile, axis, angle),
    fillet: (shape, edges, radius) => fake.fillet(shape, edges, radius),
    chamfer: (shape, edges, distance) => fake.chamfer(shape, edges, distance),
    boundingBox: (shape) => fake.boundingBox(shape),
    topology: (shape) => fake.topology(shape),
  };
  return { fake, kernel, calls };
}

/** A body created by the feature `origin`, frozen and named like the output of a builder. */
function aBody(origin: string, shape: ShapeHandle, names: NameTable): Body {
  return Object.freeze({
    kind: 'body',
    id: bodyId(fid(origin)),
    origin: fid(origin),
    lastModifiedBy: fid(origin),
    shape,
    names,
  });
}

/** The face names of a table as plain entries, for comparing tables. */
function faceNames(names: NameTable): [string, readonly number[]][] {
  return [...names.faceEntries];
}

/** EMPTY_STATE followed by the artifacts, in this order. */
function aState(...artifacts: Artifact[]): RegenState {
  const map = new Map<ArtifactId, Artifact>(EMPTY_STATE.artifacts);
  for (const a of artifacts) map.set(a.id, a);
  return Object.freeze({ artifacts: map });
}

function bodyAt(state: RegenState, id: BodyId): Body {
  const a = state.artifacts.get(id);
  if (a?.kind !== 'body') expect.fail(`no body ${id}`);
  return a;
}

/**
 * A prism of the feature: the rectangle [x0, x0 + w] × [y0, y0 + h] on the plane z = z0 extruded
 * along +Z by `height`, with the roles and the history of the kernel.
 */
async function prism(
  kernel: ModelingKernel,
  [x0, y0, z0]: Vec3,
  [w, h, height]: Vec3,
): Promise<ShapeResult> {
  const corners: [number, number][] = [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h],
  ];
  const outer = corners.map((from, i) => ({
    kind: 'line' as const,
    from,
    to: corners[(i + 1) % corners.length] ?? from,
  }));
  const plane = { origin: [0, 0, z0] as Vec3, xDir: [1, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
  const face = await kernel.makeFace({ plane, outer, holes: [] });
  return kernel.extrude(face.shape, [0, 0, 1], height);
}

/** A named box body of the feature `origin`. */
async function boxBody(kernel: ModelingKernel, origin: string, at: Vec3): Promise<Body> {
  const result = await kernel.makeBox({ origin: at, size: [10, 10, 10] });
  const names = await nameShape({ kernel, featureId: fid(origin), result, inputs: [] });
  return aBody(origin, result.shape, names);
}

/** Three bodies a, b, c (boxes 10 apart along x) after a sketch, and two prisms of the feature. */
async function setup() {
  const rec = aRecordingKernel();
  const { kernel } = rec;
  const a = await boxBody(kernel, 'a', [0, 0, 0]);
  const b = await boxBody(kernel, 'b', [20, 0, 0]);
  const c = await boxBody(kernel, 'c', [40, 0, 0]);
  const sketch = aSketchArtifact('s');
  const state = aState(a, sketch, b, c);
  const p1 = await prism(kernel, [5, 0, 0], [20, 5, 5]);
  const p2 = await prism(kernel, [0, 0, 20], [5, 5, 5]);
  return { ...rec, a, b, c, sketch, state, p1, p2 };
}

const ORIGIN_KEYS = [...EMPTY_STATE.artifacts.keys()];

describe('applyBodyOperation', () => {
  describe('new', () => {
    it('makes one shape a new body of the feature at the end of the map, without a boolean', async () => {
      const { kernel, calls, state, p1, sketch } = await setup();
      const out = await applyBodyOperation({
        kernel,
        state,
        feature: FEATURE,
        op: 'new',
        shapes: [p1],
        targets: [],
      });
      expect(calls).toEqual([]);
      const id = bodyId(FEATURE);
      expect([...out.artifacts.keys()]).toEqual([
        ...ORIGIN_KEYS,
        'a/body',
        sketch.id,
        'b/body',
        'c/body',
        id,
      ]);
      const body = bodyAt(out, id);
      expect(body).toEqual({
        kind: 'body',
        id,
        origin: FEATURE,
        lastModifiedBy: FEATURE,
        shape: p1.shape,
        names: body.names,
      });
    });

    it('names one shape by the roles of the prism (M14)', async () => {
      const { kernel, fake, state, p1 } = await setup();
      const out = await applyBodyOperation({
        kernel,
        state,
        feature: FEATURE,
        op: 'new',
        shapes: [p1],
        targets: [],
      });
      const { names } = bodyAt(out, bodyId(FEATURE));
      // The fake extrude along +Z: start is the wall −Z (4), end the wall +Z (5).
      expect(faceNames(names)).toEqual([
        ['e1/face:end', [5]],
        ['e1/face:start', [4]],
      ]);
      expect(names.topology).toEqual(await fake.topology(p1.shape));
    });

    it('unites several shapes into one body with a single union', async () => {
      const { kernel, fake, calls, state, p1, p2 } = await setup();
      const out = await applyBodyOperation({
        kernel,
        state,
        feature: FEATURE,
        op: 'new',
        shapes: [p1, p2],
        targets: [],
      });
      expect(calls).toEqual([{ op: 'union', targets: [p1.shape], tools: [p2.shape] }]);
      const body = bodyAt(out, bodyId(FEATURE));
      expect(await fake.boundingBox(body.shape)).toEqual({ min: [0, 0, 0], max: [25, 5, 25] });
      expect(bodiesOf(out)).toHaveLength(4);
      // The names of the prisms go over the history of the union (fake: the first is the identity).
      expect(body.names.faces(tn('e1/face:start'))).toEqual([4]);
      expect(body.names.faces(tn('e1/face:end'))).toEqual([5]);
    });

    it('ignores targets', async () => {
      const { kernel, calls, state, p1, a } = await setup();
      const out = await applyBodyOperation({
        kernel,
        state,
        feature: FEATURE,
        op: 'new',
        shapes: [p1],
        targets: [a],
      });
      expect(calls).toEqual([]);
      expect(bodyAt(out, a.id)).toBe(a);
    });
  });

  describe('add', () => {
    it('unites the first target with the other targets and the shapes; the others leave', async () => {
      const { kernel, fake, calls, state, a, c, b, p1, p2, sketch } = await setup();
      const out = await applyBodyOperation({
        kernel,
        state,
        feature: FEATURE,
        op: 'add',
        shapes: [p1, p2],
        targets: [c, a],
      });
      expect(calls).toEqual([
        { op: 'union', targets: [c.shape], tools: [a.shape, p1.shape, p2.shape] },
      ]);
      // The result keeps the identity and the place of the first target c; a is consumed.
      expect([...out.artifacts.keys()]).toEqual([...ORIGIN_KEYS, sketch.id, 'b/body', 'c/body']);
      const result = bodyAt(out, c.id);
      expect(result).toEqual({
        ...c,
        shape: result.shape,
        names: result.names,
        lastModifiedBy: FEATURE,
      });
      expect(result.origin).toBe(fid('c'));
      expect(result.shape).not.toBe(c.shape);
      expect(bodyAt(out, b.id)).toBe(b);
      expect(await fake.boundingBox(result.shape)).toEqual({ min: [0, 0, 0], max: [50, 10, 25] });
    });

    it('carries the names over the history of the union (M14)', async () => {
      const { kernel, fake, state, a, c, p1 } = await setup();
      const out = await applyBodyOperation({
        kernel,
        state,
        feature: FEATURE,
        op: 'add',
        shapes: [p1],
        targets: [c, a],
      });
      const result = bodyAt(out, c.id);
      // Fake boolean: the first input (target c) is the identity, the others are deleted.
      expect(faceNames(result.names)).toEqual(faceNames(c.names));
      expect(result.names.faces(tn('c/face:top'))).toEqual([5]);
      expect(result.names.topology).toEqual(await fake.topology(result.shape));
    });
  });

  describe.each([
    ['remove', 'subtract'],
    ['intersect', 'intersect'],
  ] as const)('%s', (op, booleanOp) => {
    it(`calls ${booleanOp} for each target on its own and keeps the identity of each`, async () => {
      const { kernel, calls, state, a, b, c, p1, p2, sketch } = await setup();
      const out = await applyBodyOperation({
        kernel,
        state,
        feature: FEATURE,
        op,
        shapes: [p1, p2],
        targets: [b, a],
      });
      expect(calls).toEqual([
        { op: booleanOp, targets: [b.shape], tools: [p1.shape, p2.shape] },
        { op: booleanOp, targets: [a.shape], tools: [p1.shape, p2.shape] },
      ]);
      expect([...out.artifacts.keys()]).toEqual([
        ...ORIGIN_KEYS,
        'a/body',
        sketch.id,
        'b/body',
        'c/body',
      ]);
      for (const target of [a, b]) {
        const changed = bodyAt(out, target.id);
        expect(changed).toEqual({
          ...target,
          shape: changed.shape,
          names: changed.names,
          lastModifiedBy: FEATURE,
        });
        // The names of each target go over the history of its own boolean (M14).
        expect(faceNames(changed.names)).toEqual(faceNames(target.names));
        expect(changed.names).not.toBe(target.names);
        expect(changed.shape).not.toBe(target.shape);
      }
      expect(bodyAt(out, c.id)).toBe(c);
    });
  });

  it('freezes the new state and the new bodies; the input state stays as it was', async () => {
    const { kernel, state, a, p1 } = await setup();
    const before = [...state.artifacts.entries()];
    for (const op of ['new', 'add', 'remove', 'intersect'] as const) {
      const out = await applyBodyOperation({
        kernel,
        state,
        feature: FEATURE,
        op,
        shapes: [p1],
        targets: [a],
      });
      expect(Object.isFrozen(out)).toBe(true);
      expect(out.artifacts).not.toBe(state.artifacts);
      for (const body of bodiesOf(out)) {
        expect(Object.isFrozen(body)).toBe(true);
        expect(Object.isFrozen(body.names)).toBe(true);
      }
    }
    expect([...state.artifacts.entries()]).toEqual(before);
  });

  it('lets a kernel error through', async () => {
    const { kernel, fake, state, a, p1 } = await setup();
    fake.failNext('boolean', 'operation-failed');
    const run = applyBodyOperation({
      kernel,
      state,
      feature: FEATURE,
      op: 'remove',
      shapes: [p1],
      targets: [a],
    });
    await expect(run).rejects.toSatisfy((e) => kernelErrorCode(e) === 'operation-failed');
  });

  it('throws on no shapes (a programming error)', async () => {
    const { kernel, state } = await setup();
    await expect(
      applyBodyOperation({ kernel, state, feature: FEATURE, op: 'new', shapes: [], targets: [] }),
    ).rejects.toThrow();
  });

  it.each(['add', 'remove', 'intersect'] as const)(
    'throws on %s without targets (a programming error)',
    async (op) => {
      const { kernel, state, p1 } = await setup();
      await expect(
        applyBodyOperation({ kernel, state, feature: FEATURE, op, shapes: [p1], targets: [] }),
      ).rejects.toThrow();
    },
  );

  it('keeps the origin planes in front', async () => {
    const { kernel, state, p1 } = await setup();
    const out = await applyBodyOperation({
      kernel,
      state,
      feature: FEATURE,
      op: 'new',
      shapes: [p1],
      targets: [],
    });
    expect([...out.artifacts.keys()][0]).toBe(ORIGIN_PLANE_IDS.xy);
  });
});
