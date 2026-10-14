import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import { ORIGIN_PLANE_IDS, bodyId } from '@/document';
import type { BodyId, FeatureId } from '@/document';
import { kernelErrorCode } from '@/kernel';
import type { BooleanOp, ShapeHandle } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { applyBodyOperation } from './body-operation';
import type { ModelingKernel } from './builder';
import { EMPTY_NAMES, EMPTY_STATE, bodiesOf } from './state';
import type { Artifact, ArtifactId, Body, RegenState } from './state';
import { aSketchArtifact } from './testing';

// The body operation of Extrude and Revolve (spec 07, Operace tělesa): identity of the new or
// changed bodies, order of the map, the boolean calls made.

// Feature ids are plain strings in tests; bodyId mints the body ids like in a builder.
const fid = (s: string): FeatureId => s as FeatureId;
const FEATURE = fid('e1');

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
    extrude: (profile, direction, distance) => fake.extrude(profile, direction, distance),
    revolve: (profile, axis, angle) => fake.revolve(profile, axis, angle),
    boundingBox: (shape) => fake.boundingBox(shape),
  };
  return { fake, kernel, calls };
}

async function box(kernel: ModelingKernel, origin: Vec3, size: Vec3): Promise<ShapeHandle> {
  return (await kernel.makeBox({ origin, size })).shape;
}

/** A body created by the feature `origin`, frozen like the output of a builder. */
function aBody(origin: string, shape: ShapeHandle): Body {
  return Object.freeze({
    kind: 'body',
    id: bodyId(fid(origin)),
    origin: fid(origin),
    lastModifiedBy: fid(origin),
    shape,
    names: EMPTY_NAMES,
  });
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

/** Three bodies a, b, c (boxes 10 apart along x) after a sketch, and two prisms of the feature. */
async function setup() {
  const rec = aRecordingKernel();
  const { kernel } = rec;
  const a = aBody('a', await box(kernel, [0, 0, 0], [10, 10, 10]));
  const b = aBody('b', await box(kernel, [20, 0, 0], [10, 10, 10]));
  const c = aBody('c', await box(kernel, [40, 0, 0], [10, 10, 10]));
  const sketch = aSketchArtifact('s');
  const state = aState(a, sketch, b, c);
  const p1 = await box(kernel, [5, 0, 0], [20, 5, 5]);
  const p2 = await box(kernel, [0, 0, 20], [5, 5, 5]);
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
      expect(bodyAt(out, id)).toEqual({
        kind: 'body',
        id,
        origin: FEATURE,
        lastModifiedBy: FEATURE,
        shape: p1,
        names: EMPTY_NAMES,
      });
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
      expect(calls).toEqual([{ op: 'union', targets: [p1], tools: [p2] }]);
      const body = bodyAt(out, bodyId(FEATURE));
      expect(await fake.boundingBox(body.shape)).toEqual({ min: [0, 0, 0], max: [25, 5, 25] });
      expect(bodiesOf(out)).toHaveLength(4);
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
      expect(calls).toEqual([{ op: 'union', targets: [c.shape], tools: [a.shape, p1, p2] }]);
      // The result keeps the identity and the place of the first target c; a is consumed.
      expect([...out.artifacts.keys()]).toEqual([...ORIGIN_KEYS, sketch.id, 'b/body', 'c/body']);
      const result = bodyAt(out, c.id);
      expect(result).toEqual({ ...c, shape: result.shape, lastModifiedBy: FEATURE });
      expect(result.origin).toBe(fid('c'));
      expect(result.names).toBe(c.names);
      expect(result.shape).not.toBe(c.shape);
      expect(bodyAt(out, b.id)).toBe(b);
      expect(await fake.boundingBox(result.shape)).toEqual({ min: [0, 0, 0], max: [50, 10, 25] });
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
        { op: booleanOp, targets: [b.shape], tools: [p1, p2] },
        { op: booleanOp, targets: [a.shape], tools: [p1, p2] },
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
        expect(changed).toEqual({ ...target, shape: changed.shape, lastModifiedBy: FEATURE });
        expect(changed.names).toBe(target.names);
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
      for (const body of bodiesOf(out)) expect(Object.isFrozen(body)).toBe(true);
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
