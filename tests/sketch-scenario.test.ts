// The sketcher of M12 end to end with the real planegcs solver (in the calling thread) over
// FakeKernel: a document with operations, log and UndoManager, the Regenerator with the sketch
// plugin, the FeatureEditor and the SketchEditor drawing into a FakeViewport. Checks the degrees
// of freedom of a rectangle as it gets constrained, a changed dimension moving the points, a
// conflict leaving the data alone, one log entry per sketching, the region in the regeneration,
// undo/redo, replaying the log and dragging a point.

import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Plane, Vec2 } from '@/core';
import {
  ORIGIN_PLANES,
  ORIGIN_PLANE_IDS,
  createDocument,
  createFeatureSchemaRegistry,
  toData,
} from '@/document';
import type { DocumentId, FeatureId, PlaneId } from '@/document';
import { sketchPlugin } from '@/features/sketch';
import {
  createFeatureEditor,
  createSketchEditor,
  createManipulatorRegistry,
  createToolRegistry,
} from '@/interaction';
import type { SketchSession } from '@/interaction';
import { FakeViewport } from '@/interaction/testing';
import { createFakeKernel } from '@/kernel/testing';
import {
  createOpHandlerRegistry,
  createOperationDispatcher,
  createOperationLog,
  createUndoManager,
  replayLog,
} from '@/ops';
import type { BatchOp } from '@/ops';
import { registerPlugin } from '@/plugin-api';
import { createBuilderRegistry, createRegenerator, sketchesOf } from '@/regen';
import { constraintFor, dimensionFor } from '@/sketch';
import type {
  SketchConstraint,
  SketchConstraintDraft,
  SketchConstraintId,
  SketchEntity,
  SketchPoint,
} from '@/sketch';
import { createInThreadPlanegcsSolver } from '@/solver-planegcs/testing';
import { rectangleData } from '@/sketch/testing';

const META = { id: 'sketch-scenario' as DocumentId, name: 'Sketch', createdAt: 0 }; // a test id is trusted
const TOLERANCE = 1e-6;

function setup() {
  const kernel = createFakeKernel();
  const schemas = createFeatureSchemaRegistry();
  const builders = createBuilderRegistry();
  // The plugin directly: app (BUILT_IN_PLUGINS) needs the DOM types.
  registerPlugin(sketchPlugin, {
    schemas,
    builders,
    tools: createToolRegistry(),
    manipulators: createManipulatorRegistry(),
  });
  const doc = createDocument({ meta: META });
  const log = createOperationLog();
  const handlers = createOpHandlerRegistry({ schemas });
  const ops = createOperationDispatcher({ doc, handlers, log });
  const undo = createUndoManager({ dispatcher: ops, log });
  const regenerator = createRegenerator({ kernel, schemas, builders, now: () => 0 });
  const ids = createSequentialIdGenerator('f');
  const features = createFeatureEditor({
    doc,
    ops,
    schemas,
    ids,
    translate: (key) => sketchPlugin.messages?.en[key] ?? key,
  });
  const viewport = new FakeViewport();
  const planes = new Map<PlaneId, Plane>(ORIGIN_PLANES.map((p) => [p.id, p.plane]));
  const sketcher = createSketchEditor({
    features,
    solver: createInThreadPlanegcsSolver(),
    viewport,
    resolvePlane: (ref) => (ref.kind === 'plane' ? planes.get(ref.plane) : undefined),
  });

  /** Regenerates the document; the sketch artifacts of the final state. */
  async function regenerate() {
    const result = await regenerator.run(doc.studio);
    if (result === 'superseded') expect.fail('Unexpected superseded run');
    return { result, sketches: sketchesOf(result.finalState) };
  }

  return { kernel, doc, log, handlers, undo, sketcher, regenerate };
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

function point(session: SketchSession, id: string): SketchPoint {
  const found = entity(session, id);
  if (found.kind !== 'point') expect.fail(`'${id}' is not a point`);
  return found;
}

function expectAt(p: SketchPoint, [x, y]: Vec2): void {
  expect(Math.abs(p.x - x)).toBeLessThan(TOLERANCE);
  expect(Math.abs(p.y - y)).toBeLessThan(TOLERANCE);
}

/** The id of the width dimension (distance a–b) of the scenario. */
const WIDTH = 'w' as SketchConstraintId; // a test id is trusted

/** A new sketch on XY: a 40 × 20 rectangle at the origin, a fixed, width and height. */
async function constrainedRectangle(s: ReturnType<typeof setup>) {
  const session = s.sketcher.create({ kind: 'plane', plane: ORIGIN_PLANE_IDS.xy });
  expect(await session.addGeometry(rectangleData({ x: 0, y: 0, width: 40, height: 20 }))).toBe(
    true,
  );
  const dof0 = session.state.get().dof;

  const data = () => ({
    entities: session.state.get().entities,
    constraints: session.state.get().constraints,
  });
  expect(
    await session.addConstraint(withId(constraintFor('fix', [entity(session, 'a')]), 'fa')),
  ).toBe(true);
  const dof1 = session.state.get().dof;

  const ab = [entity(session, 'a'), entity(session, 'b')];
  expect(await session.addConstraint(withId(dimensionFor(ab, data()), WIDTH))).toBe(true);
  const bc = [entity(session, 'b'), entity(session, 'c')];
  expect(await session.addConstraint(withId(dimensionFor(bc, data()), 'h'))).toBe(true);
  return { session, dofs: [dof0, dof1, session.state.get().dof], data };
}

describe('sketch scenario (rectangle with the real solver)', () => {
  it('a rectangle loses its degrees of freedom: 4, fixed 2, dimensioned 0', async () => {
    const s = setup();
    const { session, dofs } = await constrainedRectangle(s);

    expect(dofs).toEqual([4, 2, 0]);
    expect(session.state.get()).toMatchObject({ status: 'ok', fullyDefined: true });
  });

  it('a new width moves b and c, a stays and the sketch stays fully defined', async () => {
    const s = setup();
    const { session } = await constrainedRectangle(s);

    expect(await session.setDimension(WIDTH, 60)).toBe(true);
    expectAt(point(session, 'a'), [0, 0]);
    expectAt(point(session, 'b'), [60, 0]);
    expectAt(point(session, 'c'), [60, 20]);
    expect(session.state.get().fullyDefined).toBe(true);
  });

  it('a conflicting diagonal dimension is refused and leaves the data alone', async () => {
    const s = setup();
    const { session, data } = await constrainedRectangle(s);
    const before = data();

    const ac = [entity(session, 'a'), entity(session, 'c')];
    const diagonal = { ...withId(dimensionFor(ac, before), 'diag'), value: 100 };
    expect(await session.addConstraint(diagonal)).toBe(false);
    expect(session.state.get().message).toEqual({ key: 'sketch.conflict' });
    expect(data()).toEqual(before);
  });

  it('finishing writes one log entry and regenerates one region', async () => {
    const s = setup();
    const { session } = await constrainedRectangle(s);
    await session.setDimension(WIDTH, 60);
    const entries = s.log.entries().length;

    session.finish();
    expect(s.log.entries()).toHaveLength(entries + 1);
    const op = s.log.entries().at(-1)?.op;
    if (op?.type !== 'batch') expect.fail('The sketching is not one batch');
    // Operation is open (type: string), so the check above does not narrow it.
    expect((op as BatchOp).ops.map((o) => o.type)).toEqual(['feature.add', 'feature.setParams']);
    expect(s.sketcher.current.get()).toBeNull();
    expect(s.sketcher.mode.get()).toBe('model');

    const { result, sketches } = await s.regenerate();
    expect([...result.statuses.values()].map((st) => st.kind)).toEqual(['ok']);
    expect(sketches).toHaveLength(1);
    expect(sketches[0]?.owner).toBe(session.featureId);
    expect([...(sketches[0]?.regions.keys() ?? [])]).toEqual(['ab,bc,cd,da']);
    expect(s.kernel.callCount('makeFace')).toBe(1);
  });

  it('undo removes the sketch, redo brings it back', async () => {
    const s = setup();
    const { session } = await constrainedRectangle(s);
    session.finish();
    const featureId = session.featureId;

    s.undo.undo();
    expect(s.doc.feature(featureId)).toBeUndefined();
    expect((await s.regenerate()).sketches).toEqual([]);

    s.undo.redo();
    expect(s.doc.feature(featureId)).toBeDefined();
    expect((await s.regenerate()).sketches.map((a) => a.owner)).toEqual([featureId]);
  });

  it('replays the log into a new document with the same data', async () => {
    const s = setup();
    const { session } = await constrainedRectangle(s);
    await session.setDimension(WIDTH, 60);
    session.finish();
    s.undo.undo();
    s.undo.redo();

    const copy = createDocument({ meta: META });
    replayLog(copy, s.handlers, s.log.entries());
    expect(toData(copy)).toEqual(toData(s.doc));
  });

  it('editing an existing sketch writes one feature.setParams', async () => {
    const s = setup();
    const { session } = await constrainedRectangle(s);
    session.finish();
    const featureId: FeatureId = session.featureId;
    const entries = s.log.entries().length;

    const edit = s.sketcher.edit(featureId);
    expect(await edit.setDimension(WIDTH, 60)).toBe(true);
    expectAt(point(edit, 'c'), [60, 20]);
    edit.finish();

    expect(s.log.entries()).toHaveLength(entries + 1);
    expect(s.log.entries().at(-1)?.op.type).toBe('feature.setParams');
  });

  it('editing and cancelling leaves the log alone', async () => {
    const s = setup();
    const { session } = await constrainedRectangle(s);
    session.finish();
    const entries = s.log.entries();
    const data = toData(s.doc);

    const edit = s.sketcher.edit(session.featureId);
    expect(await edit.setDimension(WIDTH, 60)).toBe(true);
    edit.cancel();

    expect(s.log.entries()).toEqual(entries);
    expect(toData(s.doc)).toEqual(data);
    expect(s.sketcher.mode.get()).toBe('model');
  });

  it('dragging a corner of an underdefined rectangle moves it to the target', async () => {
    const s = setup();
    const session = s.sketcher.create({ kind: 'plane', plane: ORIGIN_PLANE_IDS.xy });
    await session.addGeometry(rectangleData({ x: 0, y: 0, width: 40, height: 20 }));

    session.drag(point(session, 'c').id, [50, 30]);
    await session.endDrag();
    expectAt(point(session, 'c'), [50, 30]);
    expect(session.state.get().dof).toBe(4);
  });
});
