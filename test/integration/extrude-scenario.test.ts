// The extrude of M13 end to end, wired like app does it (document, dispatcher, log,
// UndoManager, Regenerator, FeatureEditor and the plugins box, sketch and extrude):
// - over FakeKernel with the real planegcs solver: a dimensioned rectangle extruded, a changed
//   dimension of the sketch regenerating the same body, undo, replaying the log and a deleted
//   line leaving the extrude with an unresolved region;
// - over the OCCT kernel in the calling thread: a circle extruded with 'remove' out of a box
//   makes a hole – the body keeps the id of the box and has the topology and volume of a hole.

import { beforeAll, describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Plane, Vec3 } from '@/core';
import {
  ORIGIN_PLANES,
  ORIGIN_PLANE_IDS,
  bodyId,
  createDocument,
  createFeatureSchemaRegistry,
  toData,
} from '@/document';
import type { DocumentId, FeatureId, PlaneId, SketchRegionRef } from '@/document';
import { boxPlugin } from '@/features/box';
import { extrudePlugin } from '@/features/extrude';
import { sketchPlugin } from '@/features/sketch';
import { createFeatureEditor, createManipulatorRegistry, createToolRegistry } from '@/interaction';
import { FakeViewport } from '@/interaction/testing';
import type { BoundingBox, GeometryKernel, MeshData } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { createInThreadOcctKernel } from '@/kernel-occt/testing';
import {
  createOpHandlerRegistry,
  createOperationDispatcher,
  createOperationLog,
  createUndoManager,
  replayLog,
} from '@/ops';
import { registerPlugin } from '@/plugin-api';
import { bodiesOf, createBuilderRegistry, createRegenerator, sketchesOf } from '@/regen';
import type { RegenResult } from '@/regen';
import { constraintFor, dimensionFor } from '@/sketch';
import type {
  SketchConstraint,
  SketchConstraintDraft,
  SketchConstraintId,
  SketchEntity,
} from '@/sketch';
import { createFakeSketchGeometry, rectangleData, createFakeTextOutliner } from '@/sketch/testing';
import { createSketchEditor } from '@/sketcher';
import type { SketchSession } from '@/sketcher';
import { createInThreadPlanegcsSolver } from '@/solver-planegcs/testing';

const META = { id: 'extrude-scenario' as DocumentId, name: 'Extrude', createdAt: 0 }; // a test id is trusted
const TOLERANCE = 1e-6;
const FINE = { linearDeflection: 0.01, angularDeflection: 0.05 };

function setup(kernel: GeometryKernel) {
  const schemas = createFeatureSchemaRegistry();
  const builders = createBuilderRegistry();
  const tools = createToolRegistry();
  const manipulators = createManipulatorRegistry();
  // The plugins of the scenario directly: app (BUILT_IN_PLUGINS) needs the DOM types.
  for (const plugin of [boxPlugin, sketchPlugin, extrudePlugin]) {
    registerPlugin(plugin, { schemas, builders, tools, manipulators });
  }
  const doc = createDocument({ meta: META });
  const log = createOperationLog();
  const handlers = createOpHandlerRegistry({ schemas });
  const ops = createOperationDispatcher({ doc, handlers, log });
  const undo = createUndoManager({ dispatcher: ops, log });
  const regenerator = createRegenerator({ kernel, schemas, builders, now: () => 0 });
  const ids = createSequentialIdGenerator('f');
  const features = createFeatureEditor({ doc, ops, schemas, ids, translate: (key) => key });
  const planes = new Map<PlaneId, Plane>(ORIGIN_PLANES.map((p) => [p.id, p.plane]));
  const sketcher = createSketchEditor({
    features,
    solver: createInThreadPlanegcsSolver(),
    geometry: createFakeSketchGeometry(),
    text: createFakeTextOutliner(),
    viewport: new FakeViewport(),
    resolvePlane: (ref) => (ref.kind === 'plane' ? planes.get(ref.plane) : undefined),
    // Only origin planes here: the reference is the plane of the artifact.
    planeOfSketch: () => undefined,
  });

  /** Creates a feature of the type through the dialog with the given params, OK. */
  function add(type: string, params: Readonly<Record<string, unknown>>): FeatureId {
    const session = features.create(type);
    session.setParams(params);
    session.commit();
    return session.featureId;
  }

  async function regenerate(): Promise<RegenResult> {
    const result = await regenerator.run(doc.studio);
    if (result === 'superseded') expect.fail('Unexpected superseded run');
    return result;
  }

  /** The region refs of the sketch in the final state of the result, in their order. */
  function regionsOf(result: RegenResult, sketch: FeatureId): SketchRegionRef[] {
    const artifact = sketchesOf(result.finalState).find((a) => a.owner === sketch);
    if (artifact === undefined) expect.fail(`No sketch artifact of '${sketch}'`);
    return [...artifact.regions.keys()].map((region) => ({ kind: 'region', sketch, region }));
  }

  return { kernel, doc, log, handlers, undo, features, sketcher, add, regenerate, regionsOf };
}

/** The constraint with the id; drafts come from the editing helpers of sketch. */
function withId(draft: SketchConstraintDraft | null, id: string): SketchConstraint {
  if (draft === null) expect.fail(`No constraint for '${id}'`);
  // A draft plus an id is a constraint; the test id is trusted like the ids of the tools.
  return { ...draft, id: id as SketchConstraintId };
}

function entity(session: SketchSession, id: string): SketchEntity {
  const found = session.state.get().entities.find((e) => e.id === id);
  if (found === undefined) expect.fail(`No entity '${id}'`);
  return found;
}

function expectVecClose(actual: Vec3, expected: Vec3): void {
  actual.forEach((c, k) => {
    expect(Math.abs(c - (expected[k] ?? Number.NaN))).toBeLessThan(TOLERANCE);
  });
}

function expectBox(actual: BoundingBox, min: Vec3, max: Vec3): void {
  expectVecClose(actual.min, min);
  expectVecClose(actual.max, max);
}

function faceCount(mesh: MeshData): number {
  return mesh.faceRanges.length / 3;
}

/** Volume enclosed by the triangles (divergence theorem): Σ a · (b × c) / 6. */
function volume(mesh: MeshData): number {
  const p = (i: number): Vec3 => [
    mesh.positions[3 * i] ?? Number.NaN,
    mesh.positions[3 * i + 1] ?? Number.NaN,
    mesh.positions[3 * i + 2] ?? Number.NaN,
  ];
  let sum = 0;
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const a = p(mesh.indices[3 * t] ?? Number.NaN);
    const b = p(mesh.indices[3 * t + 1] ?? Number.NaN);
    const c = p(mesh.indices[3 * t + 2] ?? Number.NaN);
    sum +=
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return sum / 6;
}

function expectWithinPercent(actual: number, expected: number, percent: number): void {
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThanOrEqual(percent / 100);
}

/** The id of the width dimension (distance a–b) of the rectangle. */
const WIDTH = 'w' as SketchConstraintId; // a test id is trusted

/**
 * A sketch on XY with a 40 × 20 rectangle at the origin, a fixed, width and height, Done; then
 * an extrude of its region by 10.
 */
async function extrudedRectangle() {
  const s = setup(createFakeKernel());
  const session = s.sketcher.create({ kind: 'plane', plane: ORIGIN_PLANE_IDS.xy });
  expect(await session.addGeometry(rectangleData({ x: 0, y: 0, width: 40, height: 20 }))).toBe(
    true,
  );
  const data = () => ({
    entities: session.state.get().entities,
    constraints: session.state.get().constraints,
  });
  expect(
    await session.addConstraint(withId(constraintFor('fix', [entity(session, 'a')]), 'fa')),
  ).toBe(true);
  const ab = [entity(session, 'a'), entity(session, 'b')];
  expect(await session.addConstraint(withId(dimensionFor(ab, data()), WIDTH))).toBe(true);
  const bc = [entity(session, 'b'), entity(session, 'c')];
  expect(await session.addConstraint(withId(dimensionFor(bc, data()), 'h'))).toBe(true);
  session.finish();
  const sketch = session.featureId;

  const regions = s.regionsOf(await s.regenerate(), sketch);
  const entries = s.log.entries().length;
  const dialog = s.features.create('extrude');
  dialog.setParam('regions', regions);
  dialog.commit();
  expect(s.log.entries()).toHaveLength(entries + 1);
  return { ...s, sketch, extrude: dialog.featureId };
}

/** The bounding box of the only body of the result, which must be the body of the feature. */
async function onlyBodyBox(
  kernel: GeometryKernel,
  result: RegenResult,
  owner: FeatureId,
): Promise<BoundingBox> {
  const bodies = bodiesOf(result.finalState);
  expect(bodies.map((b) => b.id)).toEqual([bodyId(owner)]);
  const [body] = bodies;
  if (body === undefined) expect.fail('No body');
  return kernel.boundingBox(body.shape);
}

describe('extrude scenario (rectangle, real solver, FakeKernel)', () => {
  it('extrudes the region of the rectangle into one body 40 × 20 × 10', async () => {
    const { kernel, extrude, regenerate } = await extrudedRectangle();

    const result = await regenerate();
    expect([...result.statuses.values()].map((st) => st.kind)).toEqual(['ok', 'ok']);
    expectBox(await onlyBodyBox(kernel, result, extrude), [0, 0, 0], [40, 20, 10]);
  });

  it('a new width of the sketch regenerates the same body 60 wide, undo brings 40 back', async () => {
    const { kernel, sketcher, sketch, extrude, undo, regenerate } = await extrudedRectangle();
    await regenerate();

    const edit = sketcher.edit(sketch);
    expect(await edit.setDimension(WIDTH, 60)).toBe(true);
    edit.finish();
    const changed = await regenerate();
    expect(changed.statuses.get(extrude)).toEqual({ kind: 'ok' });
    expectBox(await onlyBodyBox(kernel, changed, extrude), [0, 0, 0], [60, 20, 10]);

    undo.undo();
    const undone = await regenerate();
    expectBox(await onlyBodyBox(kernel, undone, extrude), [0, 0, 0], [40, 20, 10]);
  });

  it('replays the log into a new document with the same data', async () => {
    const { sketcher, sketch, doc, log, handlers, undo, regenerate } = await extrudedRectangle();
    await regenerate();
    const edit = sketcher.edit(sketch);
    await edit.setDimension(WIDTH, 60);
    edit.finish();
    undo.undo();
    undo.redo();

    const copy = createDocument({ meta: META });
    replayLog(copy, handlers, log.entries());
    expect(toData(copy)).toEqual(toData(doc));
  });

  it('a deleted line of the rectangle leaves the extrude with an unresolved region', async () => {
    const { sketcher, sketch, extrude, regenerate } = await extrudedRectangle();
    await regenerate();

    const edit = sketcher.edit(sketch);
    expect(await edit.remove([entity(edit, 'ab').id])).toBe(true);
    edit.finish();

    const result = await regenerate();
    expect(result.statuses.get(sketch)?.kind).not.toBe('error');
    const status = result.statuses.get(extrude);
    if (status?.kind !== 'error') expect.fail('The extrude is not an error');
    expect(status.error.code).toBe('UNRESOLVED_REFERENCE');
    expect(status.error.issues).toEqual([{ param: 'regions', code: 'param.unresolvedRef' }]);
    expect(bodiesOf(result.finalState)).toEqual([]);
  });
});

describe('extrude scenario (hole in a box, OCCT)', () => {
  let kernel: GeometryKernel;

  beforeAll(async () => {
    kernel = await createInThreadOcctKernel();
  });

  it('a circle extruded with remove out of a box makes a hole in the same body', async () => {
    const s = setup(kernel);
    const box = s.add('box', { origin: [0, 0, 0], width: 10, depth: 10, height: 10 });
    // The sketch data directly through the dialog, without the solver: the coordinates are final.
    const sketch = s.add('sketch', {
      plane: [{ kind: 'plane', plane: ORIGIN_PLANE_IDS.xy }],
      entities: [
        { kind: 'point', id: 'o', x: 5, y: 5 },
        { kind: 'circle', id: 'k', center: 'o', radius: 2 },
      ],
      constraints: [],
    });
    const regions = s.regionsOf(await s.regenerate(), sketch);
    expect(regions).toHaveLength(1);
    const extrude = s.add('extrude', {
      regions,
      operation: 'remove',
      targets: [{ kind: 'body', body: bodyId(box) }],
      distance: 10,
    });

    const result = await s.regenerate();
    expect([...result.statuses.values()].map((st) => st.kind)).toEqual(['ok', 'ok', 'ok']);
    const bodies = bodiesOf(result.finalState);
    expect(bodies.map((b) => [b.id, b.origin, b.lastModifiedBy])).toEqual([
      [bodyId(box), box, extrude],
    ]);
    const [body] = bodies;
    if (body === undefined) expect.fail('No body');
    const mesh = await kernel.tessellate(body.shape, FINE);
    expect(faceCount(mesh)).toBe(7);
    expectWithinPercent(volume(mesh), 1000 - 40 * Math.PI, 1);
    // Alive after the sweep (spec 07, Životnost handle): the body with the hole and the face of
    // the region of the final state, and the shape of the box, which the cached states after
    // the box and after the sketch still hold. The prism is in no state: it is released.
    const cachedBox = 1;
    expect(await kernel.liveHandleCount()).toBe(2 + cachedBox);
  });
});
