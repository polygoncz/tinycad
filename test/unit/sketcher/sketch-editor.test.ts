import { describe, expect, it, vi } from 'vitest';
import { createSequentialIdGenerator, plane as planeMath } from '@/core';
import type { Plane } from '@/core';
import {
  ORIGIN_PLANES,
  ORIGIN_PLANE_IDS,
  createFeatureSchemaRegistry,
  validateAgainstSchema,
} from '@/document';
import type {
  BodyId,
  FeatureId,
  FeatureInstance,
  FeatureSchema,
  ParamSchema,
  PlaneId,
  PlaneRef,
  TopoName,
  TopoRef,
} from '@/document';
import { aFeature } from '@/document/testing';
import type { BatchOp, FeatureSetParamsOp, Operation } from '@/ops';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, parseSketchData } from '@/sketch';
import type {
  ConstraintSolver,
  SketchConstraint,
  SketchConstraintId,
  SketchData,
  SketchEntityId,
  SketchItemId,
  SolveInput,
} from '@/sketch';
import { createFakeSolver, rectangleData } from '@/sketch/testing';
import { createActionRegistry, createFeatureEditor } from '@/interaction';
import { ORIGIN_POINT_ID } from '@/sketcher/sketch-drawing';
import { SKETCH_ACTION_IDS } from '@/sketcher/constants';
import { createSketchActions } from '@/sketcher/sketch-actions';
import { createSketchEditor } from '@/sketcher/sketch-editor';
import { EDIT_SKETCH_DRAWING_ID } from '@/sketcher/sketch-session';
import type { SketchSession } from '@/sketcher/sketch-session';
import { FakeViewport } from '@/interaction/testing';

// The schema of the sketch feature as in spec 12; the plugin comes in a later task (Ú10).
const SKETCH_PARAMS: ParamSchema = {
  plane: { kind: 'planes', label: 'sketch.plane', min: 1, max: 1 },
  entities: { kind: 'data', label: 'sketch.entities' },
  constraints: { kind: 'data', label: 'sketch.constraints' },
};

const SKETCH_SCHEMA: FeatureSchema = {
  type: SKETCH_FEATURE_TYPE,
  version: 1,
  label: 'sketch.label',
  params: SKETCH_PARAMS,
  defaults: () => ({
    plane: [{ kind: 'plane', plane: ORIGIN_PLANE_IDS.xy }],
    entities: [],
    constraints: [],
  }),
  validate: (params) => validateAgainstSchema(SKETCH_PARAMS, params),
};

const BOX_PARAMS: ParamSchema = {
  width: { kind: 'length', label: 'box.width', default: 10 },
};
const BOX_SCHEMA: FeatureSchema = {
  type: 'box',
  version: 1,
  label: 'box.label',
  params: BOX_PARAMS,
  defaults: () => ({ width: 10 }),
  validate: (params) => validateAgainstSchema(BOX_PARAMS, params),
};

const [XY, XZ] = ORIGIN_PLANES.map((p) => p.plane) as [Plane, Plane, Plane]; // a fixed table of three

/** The top face of a box [0, 10]³ as the regeneration would resolve it (M14; app: planeOfRef). */
const TOP: Plane = Object.freeze<Plane>({ origin: [0, 0, 10], xDir: [1, 0, 0], normal: [0, 0, 1] });

const planeRef = (plane: PlaneId): PlaneRef => ({ kind: 'plane', plane });
// Test ids and names are trusted.
const topoRef = (body: string, name: string): TopoRef => ({
  kind: 'topo',
  body: body as BodyId,
  name: name as TopoName,
});
const TOP_FACE = topoRef('b1/body', 'b1/face:top');

/** A fake of app's resolvePlane: the origin planes and the top face of 'b1/body' (M14). */
function resolvePlane(ref: PlaneRef | TopoRef): Plane | undefined {
  if (ref.kind === 'plane') return ORIGIN_PLANES.find((p) => p.id === ref.plane)?.plane;
  return ref.body === TOP_FACE.body && ref.name === TOP_FACE.name ? TOP : undefined;
}

// Test ids are trusted.
const fid = (id: string): FeatureId => id as FeatureId;
const eid = (id: string): SketchEntityId => id as SketchEntityId;
const item = (id: string): SketchItemId => id as SketchItemId;
const cid = (id: string): SketchConstraintId => id as SketchConstraintId;

/** Valid sketch data from plain values (parse brands the ids). */
function data(entities: readonly unknown[], constraints: readonly unknown[] = []): SketchData {
  const parsed = parseSketchData(entities, constraints);
  if (!parsed.ok) throw new Error(`invalid test data ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

/** One constraint from plain values, checked against `on`. */
function constraint(on: SketchData, c: unknown): SketchConstraint {
  const [parsed] = data(on.entities, [...on.constraints, c]).constraints.slice(-1);
  if (parsed === undefined) throw new Error('no constraint');
  return parsed;
}

/** A sketch feature with the data on the plane. */
function aSketch(
  id: string,
  sketch: SketchData = rectangleData(),
  plane: string = ORIGIN_PLANE_IDS.xy,
) {
  return aFeature<Record<string, unknown>>({
    id,
    name: `Sketch ${id}`,
    type: SKETCH_FEATURE_TYPE,
    params: {
      plane: [{ kind: 'plane', plane }],
      entities: sketch.entities,
      constraints: sketch.constraints,
    },
  });
}

/** Two points and a line between them. */
const LINE = data([
  { kind: 'point', id: 'p', x: 0, y: 0 },
  { kind: 'point', id: 'q', x: 4, y: 1 },
  { kind: 'line', id: 'pq', p1: 'p', p2: 'q' },
]);

function setup(
  opts: {
    features?: Parameters<typeof aSketch>[];
    others?: readonly FeatureInstance[];
    solver?: ConstraintSolver;
    /** app: the plane of the sketch artifact in the last state (M21); none by default. */
    planeOfSketch?: (featureId: FeatureId) => Plane | undefined;
  } = {},
) {
  const schemas = createFeatureSchemaRegistry();
  schemas.register(SKETCH_SCHEMA);
  schemas.register(BOX_SCHEMA);
  const features = [
    ...(opts.others ?? []),
    ...(opts.features ?? []).map((args) => aSketch(...args)),
  ];
  const ops = anOpsSession({ schemas, features });
  const editor = createFeatureEditor({
    doc: ops.doc,
    ops: ops.dispatcher,
    schemas,
    ids: createSequentialIdGenerator('f'),
    translate: (key) => (key === 'sketch.label' ? 'Sketch' : key),
  });
  const fake = createFakeSolver();
  const viewport = new FakeViewport();
  const sketches = createSketchEditor({
    features: editor,
    solver: opts.solver ?? fake,
    viewport,
    resolvePlane,
    planeOfSketch: opts.planeOfSketch ?? (() => undefined),
  });
  const applied: Operation[] = [];
  ops.dispatcher.events.on('applied', ({ op }) => applied.push(op));
  return { ...ops, editor, solver: fake, viewport, sketches, applied };
}

/** Lets the solver answers (microtasks) and the queue settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Data of the feature in the document. */
function docData(doc: ReturnType<typeof setup>['doc'], id: FeatureId): SketchData {
  const params = doc.feature(id)?.params as Record<string, unknown> | undefined; // a sketch feature
  return data(
    (params?.entities as readonly unknown[] | undefined) ?? [],
    (params?.constraints as readonly unknown[] | undefined) ?? [],
  );
}

/** An open session on a sketch 's1' with the data, after the first solve. */
async function editing(sketch: SketchData = rectangleData(), solver?: ConstraintSolver) {
  const ctx = setup({ features: [['s1', sketch]], ...(solver === undefined ? {} : { solver }) });
  const session = ctx.sketches.edit(fid('s1'));
  await settle();
  ctx.applied.length = 0;
  return { ...ctx, session };
}

/** Solver calls after the first one (the solve on opening). */
const laterCalls = (calls: readonly SolveInput[]) => calls.slice(1);

/**
 * Collects the unhandled rejections until `stop`. Vitest treats an unhandled rejection as handled
 * by the test when another listener exists, so the run does not fail on the expected one.
 */
function catchUnhandledRejections(): { readonly reasons: readonly unknown[]; stop(): void } {
  const reasons: unknown[] = [];
  const listener = (reason: unknown): void => {
    reasons.push(reason);
  };
  process.on('unhandledRejection', listener);
  return {
    reasons,
    stop() {
      process.off('unhandledRejection', listener);
    },
  };
}

describe('SketchEditor.create', () => {
  it('creates a sketch on the default plane XY and enters the sketch mode', () => {
    const { doc, editor, sketches } = setup();
    const modes: string[] = [];
    sketches.mode.subscribe(() => modes.push(sketches.mode.get()));

    const session = sketches.create(planeRef(ORIGIN_PLANE_IDS.xy));

    expect(sketches.current.get()).toBe(session);
    expect(sketches.mode.get()).toBe('sketch');
    expect(modes).toEqual(['sketch']);
    expect(session.plane.get()).toBe(XY);
    expect(doc.feature(session.featureId)?.type).toBe(SKETCH_FEATURE_TYPE);
    expect(editor.current.get()?.featureId).toBe(session.featureId);
    expect(session.state.get()).toMatchObject({
      open: true,
      name: 'Sketch 1',
      entities: [],
      constraints: [],
      status: 'solving',
      dof: null,
      fullyDefined: false,
      selection: [],
      hover: null,
      message: null,
      constraintRows: [],
      editingDimension: null,
    });
  });

  it('sets the plane param for another plane', () => {
    const { doc, sketches } = setup();

    const session = sketches.create(planeRef(ORIGIN_PLANE_IDS.xz));

    expect(session.plane.get()).toBe(XZ);
    expect(doc.feature(session.featureId)?.params).toMatchObject({
      plane: [{ kind: 'plane', plane: ORIGIN_PLANE_IDS.xz }],
    });
  });

  it('throws for an unknown plane before creating the feature', () => {
    const { doc, editor, sketches, applied } = setup();

    expect(() => sketches.create(planeRef('origin/plane:ab' as PlaneId))).toThrow();

    expect(doc.studio.features).toEqual([]);
    expect(applied).toEqual([]);
    expect(editor.current.get()).toBeNull();
    expect(sketches.mode.get()).toBe('model');
  });

  it('creates a sketch on a planar face: writes the TopoRef and opens on its plane (M14)', () => {
    const { doc, sketches } = setup();

    const session = sketches.create(TOP_FACE);

    expect(session.plane.get()).toBe(TOP);
    expect(doc.feature(session.featureId)?.params).toMatchObject({
      plane: [{ kind: 'topo', body: 'b1/body', name: 'b1/face:top' }],
    });
    expect(sketches.mode.get()).toBe('sketch');
  });

  it('throws for a face resolvePlane does not know, changing nothing (M14)', () => {
    const { doc, editor, sketches, applied } = setup();

    expect(() => sketches.create(topoRef('b1/body', 'b1/face:side'))).toThrow();

    expect(doc.studio.features).toEqual([]);
    expect(applied).toEqual([]);
    expect(editor.current.get()).toBeNull();
    expect(sketches.current.get()).toBeNull();
    expect(sketches.mode.get()).toBe('model');
  });

  it('throws while a session is open, changing nothing', () => {
    const { doc, sketches } = setup();
    const first = sketches.create(planeRef(ORIGIN_PLANE_IDS.xy));

    expect(() => sketches.create(planeRef(ORIGIN_PLANE_IDS.xy))).toThrow();
    expect(() => sketches.edit(first.featureId)).toThrow();
    expect(doc.studio.features).toHaveLength(1);
    expect(sketches.current.get()).toBe(first);
  });

  it('throws while a feature dialog is open', () => {
    const { editor, sketches } = setup();
    editor.create('box');

    expect(() => sketches.create(planeRef(ORIGIN_PLANE_IDS.xy))).toThrow();
    expect(sketches.current.get()).toBeNull();
  });
});

describe('SketchEditor.planeOf', () => {
  it('answers with resolvePlane: origin plane, known face, unknown face (M14)', () => {
    const { sketches } = setup();

    expect(sketches.planeOf(planeRef(ORIGIN_PLANE_IDS.xz))).toBe(XZ);
    expect(sketches.planeOf(TOP_FACE)).toBe(TOP);
    expect(sketches.planeOf(topoRef('b1/body', 'b1/face:side'))).toBeUndefined();
  });
});

describe('SketchEditor.gridSnap (M19.2 D4)', () => {
  it('is on by default and setGridSnap switches it', () => {
    const { sketches } = setup();
    const seen: boolean[] = [];
    sketches.gridSnap.subscribe(() => seen.push(sketches.gridSnap.get()));

    expect(sketches.gridSnap.get()).toBe(true);
    sketches.setGridSnap(false);
    sketches.setGridSnap(false);
    sketches.setGridSnap(true);
    expect(seen).toEqual([false, true]);
  });

  it('gridStep is deps.gridStep, read on every call; 1 without it', () => {
    expect(setup().sketches.gridStep()).toBe(1);
    let step = 5;
    const ctx = setup();
    const sketches = createSketchEditor({
      features: ctx.editor,
      solver: ctx.solver,
      viewport: ctx.viewport,
      resolvePlane,
      planeOfSketch: () => undefined,
      gridStep: () => step,
    });
    expect(sketches.gridStep()).toBe(5);
    step = 0.2;
    expect(sketches.gridStep()).toBe(0.2);
  });

  it('belongs to the editor: it survives closing and opening a sketch', () => {
    const { sketches } = setup({ features: [['s1']] });
    sketches.setGridSnap(false);

    sketches.edit(fid('s1')).cancel();
    const session = sketches.create(planeRef(ORIGIN_PLANE_IDS.xy));
    expect(sketches.gridSnap.get()).toBe(false);
    session.cancel();
    expect(sketches.gridSnap.get()).toBe(false);
  });
});

describe('SketchEditor.showAllConstraints (M25)', () => {
  it('is off by default and setShowAllConstraints switches it', () => {
    const { sketches } = setup();
    const seen: boolean[] = [];
    sketches.showAllConstraints.subscribe(() => seen.push(sketches.showAllConstraints.get()));

    expect(sketches.showAllConstraints.get()).toBe(false);
    sketches.setShowAllConstraints(true);
    sketches.setShowAllConstraints(true);
    sketches.setShowAllConstraints(false);
    expect(seen).toEqual([true, false]);
  });

  it('belongs to the editor: it survives closing and opening a sketch', () => {
    const { sketches } = setup({ features: [['s1']] });
    sketches.setShowAllConstraints(true);

    sketches.create(planeRef(ORIGIN_PLANE_IDS.xy)).cancel();
    const session = sketches.edit(fid('s1'));
    expect(sketches.showAllConstraints.get()).toBe(true);
    expect(session.state.get().glyphs).toHaveLength(4);
    session.cancel();
    expect(sketches.showAllConstraints.get()).toBe(true);
  });
});

describe('SketchEditor.edit', () => {
  it('opens an existing sketch with its data and plane', () => {
    const rect = rectangleData();
    const { sketches } = setup({ features: [['s1', rect, ORIGIN_PLANE_IDS.xz]] });

    const session = sketches.edit(fid('s1'));

    expect(session.featureId).toBe('s1');
    expect(session.plane.get()).toBe(XZ);
    expect(session.state.get()).toMatchObject({ name: 'Sketch s1' });
    expect(session.state.get().entities).toEqual(rect.entities);
    expect(session.state.get().constraints).toEqual(rect.constraints);
    expect(sketches.mode.get()).toBe('sketch');
  });

  it('throws for a feature of another type and leaves no session', () => {
    const box = aFeature({ id: 'b1', name: 'Box', type: 'box', params: { width: 1 } });
    const { editor, sketches, log, doc } = setup({ others: [box] });

    expect(() => sketches.edit(fid('b1'))).toThrow();

    expect(editor.current.get()).toBeNull();
    expect(sketches.current.get()).toBeNull();
    expect(log.entries()).toEqual([]);
    expect(doc.studio.rollbackIndex).toBe(1);
  });

  it('opens a sketch on a face with the plane of the face (M14)', () => {
    const sketch = aFeature<Record<string, unknown>>({
      id: 's2',
      name: 'Sketch s2',
      type: SKETCH_FEATURE_TYPE,
      params: { plane: [TOP_FACE], entities: [], constraints: [] },
    });
    const { sketches } = setup({ others: [sketch] });

    expect(sketches.edit(fid('s2')).plane.get()).toBe(TOP);
  });

  it.each([
    ['a face reference with an empty name', { kind: 'topo', body: 'b1/body', name: '' }],
    ['a face reference with a body id of a wrong shape', { ...TOP_FACE, body: 'b1' }],
    ['a reference of another kind', { kind: 'body', body: 'b1/body' }],
  ])(
    'opens a sketch whose plane is %s on XY without a plane (one reading with document, Q079)',
    (_, plane) => {
      const sketch = aFeature<Record<string, unknown>>({
        id: 's2',
        name: 'Sketch s2',
        type: SKETCH_FEATURE_TYPE,
        params: { plane: [plane], entities: [], constraints: [] },
      });
      const { sketches } = setup({ others: [sketch] });

      const session = sketches.edit(fid('s2'));

      expect(session.plane.get()).toBe(XY);
      expect(session.state.get().planeMissing).toBe(true);
    },
  );

  it('throws for an unknown feature', () => {
    const { sketches } = setup();
    expect(() => sketches.edit(fid('nope'))).toThrow();
    expect(sketches.current.get()).toBeNull();
  });

  it('opens on the plane of the artifact, also when the reference no longer resolves (M21)', () => {
    // A sketch on the top face of a box that a later Boolean consumed: the face is gone from the
    // final state, the artifact keeps the plane the builder computed from the input (R108).
    const gone = topoRef('b9/body', 'b9/face:top');
    const sketch = aFeature<Record<string, unknown>>({
      id: 's2',
      name: 'Sketch s2',
      type: SKETCH_FEATURE_TYPE,
      params: { plane: [gone], entities: [], constraints: [] },
    });
    const asked: FeatureId[] = [];
    const { sketches } = setup({
      others: [sketch],
      planeOfSketch: (id) => {
        asked.push(id);
        return TOP;
      },
    });
    expect(resolvePlane(gone)).toBeUndefined();

    const session = sketches.edit(fid('s2'));

    expect(session.plane.get()).toBe(TOP);
    expect(asked).toEqual(['s2']);
  });

  it('prefers the plane of the artifact to the plane of the reference (M21)', () => {
    const { sketches } = setup({
      features: [['s1', rectangleData(), ORIGIN_PLANE_IDS.xz]],
      planeOfSketch: () => TOP,
    });
    expect(sketches.edit(fid('s1')).plane.get()).toBe(TOP);
  });

  it('opens an ordinary sketch with planeMissing false and without picking the plane', () => {
    const { sketches, editor } = setup({ features: [['s1']] });
    const session = sketches.edit(fid('s1'));
    expect(session.state.get().planeMissing).toBe(false);
    expect(editor.current.get()?.state.get().activeRefParam).toBeNull();
  });
});

describe('SketchEditor.edit without a plane (Q079, variant A)', () => {
  /** A sketch on the top face of a body that is gone: no artifact, the reference does not resolve. */
  const GONE = topoRef('b9/body', 'b9/face:top');

  function lostPlane() {
    const sketch = aFeature<Record<string, unknown>>({
      id: 's2',
      name: 'Sketch s2',
      type: SKETCH_FEATURE_TYPE,
      params: { plane: [GONE], entities: LINE.entities, constraints: LINE.constraints },
    });
    const ctx = setup({ others: [sketch] });
    const session = ctx.sketches.edit(fid('s2'));
    return { ...ctx, session };
  }

  it('does not throw: opens on the origin plane XY with planeMissing', () => {
    const { session, sketches, viewport, log } = lostPlane();

    expect(sketches.current.get()).toBe(session);
    expect(sketches.mode.get()).toBe('sketch');
    expect(session.plane.get()).toBe(XY);
    expect(session.state.get().planeMissing).toBe(true);
    expect(session.state.get().entities).toEqual(LINE.entities);
    expect(viewport.sketchDrawings.get(EDIT_SKETCH_DRAWING_ID)?.plane).toBe(XY);
    expect(log.entries()).toEqual([]);
  });

  it('picks the plane at once', () => {
    const { session, editor } = lostPlane();
    expect(editor.current.get()?.state.get().activeRefParam).toBe('plane');
    expect(session.state.get().planeField?.active).toBe(true);
  });

  it('a picked plane clears planeMissing and moves the plane', () => {
    const { session, editor } = lostPlane();

    editor.current.get()?.setParam('plane', [planeRef(ORIGIN_PLANE_IDS.xz)]);

    expect(session.plane.get()).toBe(XZ);
    expect(session.state.get().planeMissing).toBe(false);
  });

  it('picking XY clears planeMissing although the plane stays the same', () => {
    const { session, editor } = lostPlane();

    editor.current.get()?.setParam('plane', [planeRef(ORIGIN_PLANE_IDS.xy)]);

    expect(session.plane.get()).toBe(XY);
    expect(session.state.get().planeMissing).toBe(false);
  });

  it('a picked face clears planeMissing', () => {
    const { session, editor } = lostPlane();
    editor.current.get()?.setParam('plane', [TOP_FACE]);
    expect(session.plane.get()).toBe(TOP);
    expect(session.state.get().planeMissing).toBe(false);
  });

  it('a reference that does not resolve keeps planeMissing', () => {
    const { session, editor } = lostPlane();
    editor.current.get()?.setParam('plane', [topoRef('b1/body', 'b1/face:round')]);
    expect(session.plane.get()).toBe(XY);
    expect(session.state.get().planeMissing).toBe(true);
  });

  it('cancelling the pick keeps the sketch open on XY with planeMissing', () => {
    const { session, sketches } = lostPlane();

    expect(session.cancelPlanePick()).toBe(true);

    expect(sketches.current.get()).toBe(session);
    expect(session.plane.get()).toBe(XY);
    expect(session.state.get().planeMissing).toBe(true);
    expect(session.state.get().planeField?.active).toBe(false);
  });

  it('finish without a picked plane writes the entities and constraints, not the plane', async () => {
    const { session, doc, log } = lostPlane();
    await settle();
    session.cancelPlanePick();
    await session.remove([item('pq')]);

    session.finish();

    const entries = log.entries();
    expect(entries.map((e) => e.op.type)).toEqual(['feature.setParams']);
    // The whole params: the entities changed, the plane is the lost reference as before.
    const params = (entries[0]?.op as FeatureSetParamsOp).params as Record<string, unknown>; // a sketch feature
    expect(params.plane).toEqual([GONE]);
    expect(params.entities).toEqual(docData(doc, fid('s2')).entities);
    expect(docData(doc, fid('s2')).entities).not.toEqual(LINE.entities);
    const saved = doc.feature(fid('s2'))?.params as Record<string, unknown> | undefined; // a sketch feature
    expect(saved?.plane).toEqual([GONE]);
  });
});

describe('SketchSession first solve', () => {
  it('solves the current data without writing it', async () => {
    const rect = rectangleData();
    const { sketches, solver, applied } = setup({ features: [['s1', rect]] });

    const session = sketches.edit(fid('s1'));

    expect(solver.calls).toHaveLength(1);
    expect(solver.calls[0]).toEqual({ entities: rect.entities, constraints: rect.constraints });
    expect(session.state.get().status).toBe('solving');
    await settle();
    expect(session.state.get()).toMatchObject({ status: 'ok', dof: 4, fullyDefined: false });
    expect(applied).toEqual([]);
  });

  it('shows a failed first solve as status failed', async () => {
    const failing: ConstraintSolver = { solve: () => Promise.reject(new Error('disconnected')) };
    const { session } = await editing(rectangleData(), failing);

    expect(session.state.get()).toMatchObject({ status: 'failed', dof: null, message: null });
  });

  it('is fully defined with status ok and dof 0', async () => {
    const ctx = setup({ features: [['s1', rectangleData()]] });
    ctx.solver.next({ dof: 0 });
    const session = ctx.sketches.edit(fid('s1'));
    await settle();

    expect(session.state.get()).toMatchObject({ status: 'ok', dof: 0, fullyDefined: true });
  });
});

describe('SketchState.statusKey (the status line of the panel)', () => {
  it('solving before the first result, without params', () => {
    const { sketches } = setup();
    const session = sketches.create(planeRef(ORIGIN_PLANE_IDS.xy));
    expect(session.state.get()).toMatchObject({
      statusKey: 'sketch.status.solving',
      statusParams: {},
    });
  });

  it('degrees of freedom with n while not fully defined', async () => {
    const ctx = setup({ features: [['s1', rectangleData()]] });
    ctx.solver.next({ dof: 4 });
    const session = ctx.sketches.edit(fid('s1'));
    await settle();
    expect(session.state.get()).toMatchObject({
      statusKey: 'sketch.status.dof',
      statusParams: { n: 4 },
    });
  });

  it('fully defined', async () => {
    const ctx = setup({ features: [['s1', rectangleData()]] });
    ctx.solver.next({ dof: 0 });
    const session = ctx.sketches.edit(fid('s1'));
    await settle();
    expect(session.state.get()).toMatchObject({
      statusKey: 'sketch.status.defined',
      statusParams: {},
    });
  });

  it('a conflicting or failed last solve', async () => {
    const ctx = setup({ features: [['s1', rectangleData()]] });
    ctx.solver.next({ status: 'conflict', entities: null, conflicting: [] });
    const conflict = ctx.sketches.edit(fid('s1'));
    await settle();
    expect(conflict.state.get().statusKey).toBe('sketch.conflict');
    conflict.cancel();
    const failing: ConstraintSolver = { solve: () => Promise.reject(new Error('disconnected')) };
    const { session } = await editing(rectangleData(), failing);
    expect(session.state.get()).toMatchObject({
      statusKey: 'sketch.solverFailed',
      statusParams: {},
    });
  });

  it('keeps the params object while the degrees of freedom stay', async () => {
    const ctx = setup({ features: [['s1', rectangleData()]] });
    ctx.solver.next({ dof: 4 });
    const session = ctx.sketches.edit(fid('s1'));
    await settle();
    const before = session.state.get();
    const first = before.entities[0];
    if (first === undefined) throw new Error('the rectangle has no entity');
    session.select(first.id);
    const after = session.state.get();
    expect(after).not.toBe(before);
    expect(after.statusParams).toBe(before.statusParams);
  });
});

describe('SketchSession writing changes', () => {
  it('addGeometry writes the solved data with one setParams and returns true', async () => {
    const { session, doc, applied, solver } = await editing(LINE);
    const add = data([...LINE.entities, { kind: 'point', id: 'r', x: 5, y: 5 }], []).entities.slice(
      -1,
    );

    const written = await session.addGeometry({ entities: add, constraints: [] });

    expect(written).toBe(true);
    expect(applied.map((op) => op.type)).toEqual(['feature.setParams']);
    expect(docData(doc, fid('s1')).entities.map((e) => e.id)).toEqual(['p', 'q', 'pq', 'r']);
    expect(laterCalls(solver.calls)[0]?.entities.map((e) => e.id)).toEqual(['p', 'q', 'pq', 'r']);
    expect(session.state.get()).toMatchObject({ status: 'ok', dof: 6, message: null });
    expect(session.state.get().entities.map((e) => e.id)).toEqual(['p', 'q', 'pq', 'r']);
  });

  it('writes the coordinates the solver returned', async () => {
    const { session, doc, solver } = await editing(LINE);
    const moved = LINE.entities.map((e) => (e.id === 'q' ? { ...e, x: 4, y: 0 } : e));
    solver.next({ entities: moved });
    const h = constraint(LINE, { kind: 'horizontal', id: 'h', line: 'pq' });

    expect(await session.addConstraint(h)).toBe(true);

    expect(docData(doc, fid('s1')).entities).toEqual(moved);
    expect(docData(doc, fid('s1')).constraints).toEqual([h]);
  });

  it('a conflict writes nothing and shows the message', async () => {
    const { session, applied, solver } = await editing(LINE);
    const h = constraint(LINE, { kind: 'horizontal', id: 'h', line: 'pq' });
    solver.next({ status: 'conflict', entities: null, conflicting: [h.id] });
    const before = session.state.get();

    expect(await session.addConstraint(h)).toBe(false);

    expect(applied).toEqual([]);
    expect(session.state.get()).toMatchObject({
      message: { key: 'sketch.conflict' },
      status: 'ok',
    });
    expect(session.state.get().constraints).toBe(before.constraints);
  });

  it('a failed solve writes nothing and shows solverFailed', async () => {
    const { session, applied, solver } = await editing(LINE);
    solver.next({ status: 'failed', entities: null, dof: null });

    expect(await session.remove([item('pq')])).toBe(false);

    expect(applied).toEqual([]);
    expect(session.state.get().message).toEqual({ key: 'sketch.solverFailed' });
  });

  it('a rejecting solver writes nothing and shows solverFailed', async () => {
    let reject = false;
    const fake = createFakeSolver();
    const solver: ConstraintSolver = {
      solve: (input) => (reject ? Promise.reject(new Error('disconnected')) : fake.solve(input)),
    };
    const { session, applied } = await editing(LINE, solver);
    reject = true;

    expect(await session.remove([item('pq')])).toBe(false);

    expect(applied).toEqual([]);
    expect(session.state.get().message).toEqual({ key: 'sketch.solverFailed' });
  });

  it('a later ok clears the message', async () => {
    const { session, solver } = await editing(LINE);
    solver.next({ status: 'failed', entities: null, dof: null });
    await session.remove([item('pq')]);

    await session.addConstraint(constraint(LINE, { kind: 'fix', id: 'f', point: 'p' }));

    expect(session.state.get().message).toBeNull();
  });

  it('addConstraint of a redundant constraint writes nothing', async () => {
    const { session, applied, solver } = await editing(LINE);
    const h = constraint(LINE, { kind: 'horizontal', id: 'h', line: 'pq' });
    solver.next({ redundant: [h.id] });

    expect(await session.addConstraint(h)).toBe(false);

    expect(applied).toEqual([]);
    expect(session.state.get().message).toEqual({ key: 'sketch.redundant' });
  });

  it('addGeometry leaves out its own redundant constraints and writes the rest', async () => {
    const rect = rectangleData();
    const { session, doc, solver } = await editing(rect);
    // A new point and a line from a to it, with an automatic horizontal the solver finds redundant.
    const added = data(
      [
        ...rect.entities,
        { kind: 'point', id: 'e', x: 20, y: 0 },
        { kind: 'line', id: 'ae', p1: 'a', p2: 'e' },
      ],
      [...rect.constraints, { kind: 'horizontal', id: 'h3', line: 'ae' }],
    );
    const add: SketchData = {
      entities: added.entities.slice(-2),
      constraints: added.constraints.slice(-1),
    };
    // An old constraint reported redundant too stays: only the added ones are dropped.
    solver.next({ redundant: [cid('h3'), cid('h1')] });

    expect(await session.addGeometry(add)).toBe(true);

    const written = docData(doc, fid('s1'));
    expect(written.entities.map((e) => e.id)).toContain('ae');
    expect(written.constraints.map((c) => c.id)).toEqual(['h1', 'v1', 'h2', 'v2']);
  });

  it('a dimension from addConstraint becomes the editing dimension', async () => {
    const { session } = await editing(LINE);
    const d = constraint(LINE, { kind: 'distance', id: 'd', a: 'p', b: 'q', value: 5 });

    expect(await session.addConstraint(d)).toBe(true);

    expect(session.state.get().editingDimension).toBe('d');
    session.clearEditingDimension();
    expect(session.state.get().editingDimension).toBeNull();
  });

  it('a geometric constraint does not set the editing dimension', async () => {
    const { session } = await editing(LINE);
    await session.addConstraint(constraint(LINE, { kind: 'horizontal', id: 'h', line: 'pq' }));
    expect(session.state.get().editingDimension).toBeNull();
  });

  it('setDimension writes the new value', async () => {
    const withDim = data(LINE.entities, [{ kind: 'distance', id: 'd', a: 'p', b: 'q', value: 5 }]);
    const { session, doc, solver } = await editing(withDim);

    expect(await session.setDimension(cid('d'), 8)).toBe(true);

    expect(docData(doc, fid('s1')).constraints).toEqual([
      { kind: 'distance', id: 'd', a: 'p', b: 'q', value: 8 },
    ]);
    expect(laterCalls(solver.calls)[0]?.constraints[0]).toMatchObject({ value: 8 });
    expect(session.state.get().constraintRows[0]).toMatchObject({ value: 8 });
  });

  it('setDimension with a conflict keeps the value', async () => {
    const withDim = data(LINE.entities, [{ kind: 'distance', id: 'd', a: 'p', b: 'q', value: 5 }]);
    const { session, doc, solver } = await editing(withDim);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });

    expect(await session.setDimension(cid('d'), 8)).toBe(false);

    expect(docData(doc, fid('s1')).constraints[0]).toMatchObject({ value: 5 });
    expect(session.state.get().message).toEqual({ key: 'sketch.conflict' });
  });

  it('setDimension of an unknown constraint or with a value ≤ 0 does nothing', async () => {
    const withDim = data(LINE.entities, [{ kind: 'distance', id: 'd', a: 'p', b: 'q', value: 5 }]);
    const { session, solver, applied } = await editing(withDim);
    const d = cid('d');

    expect(await session.setDimension(cid('nope'), 3)).toBe(false);
    expect(await session.setDimension(d, 0)).toBe(false);
    expect(await session.setDimension(d, Number.NaN)).toBe(false);

    expect(laterCalls(solver.calls)).toEqual([]);
    expect(applied).toEqual([]);
  });

  it('setDimension of an angle needs 0 < value < π, else the data would turn invalid', async () => {
    const withAngle = data(
      [
        ...LINE.entities,
        { kind: 'point', id: 'r', x: 0, y: 2 },
        { kind: 'point', id: 's', x: 1, y: 5 },
        { kind: 'line', id: 'rs', p1: 'r', p2: 's' },
      ],
      [{ kind: 'angle', id: 'g', a: 'pq', b: 'rs', value: 1 }],
    );
    const { session, solver, applied } = await editing(withAngle);

    expect(await session.setDimension(cid('g'), Math.PI)).toBe(false);
    expect(await session.setDimension(cid('g'), 4)).toBe(false);

    expect(laterCalls(solver.calls)).toEqual([]);
    expect(applied).toEqual([]);
  });

  it('data without a change is not written', async () => {
    const { session, applied } = await editing(LINE);

    expect(await session.remove([item('unknown')])).toBe(true);

    expect(applied).toEqual([]);
  });

  it('remove deletes with the cascade and drops vanished items from the selection', async () => {
    const rect = rectangleData();
    const { session, doc } = await editing(rect);
    session.select(item('ab'));
    session.select(item('a'), { additive: true });
    session.select(item('c'), { additive: true });

    expect(await session.remove([item('a')])).toBe(true);

    const written = docData(doc, fid('s1'));
    expect(written.entities.map((e) => e.id)).toEqual(['b', 'c', 'd', 'bc', 'cd']);
    expect(written.constraints.map((c) => c.id)).toEqual(['v1', 'h2']);
    expect(session.state.get().selection).toEqual(['c']);
  });

  it('toggleConstruction writes at once without the solver', async () => {
    const { session, doc, solver, applied } = await editing(LINE);

    session.toggleConstruction([item('pq')]);

    expect(applied.map((op) => op.type)).toEqual(['feature.setParams']);
    expect(docData(doc, fid('s1')).entities[2]).toMatchObject({ construction: true });
    expect(laterCalls(solver.calls)).toEqual([]);
    session.toggleConstruction([item('p')]);
    expect(applied).toHaveLength(1);
  });

  it('toggleConstruction behind a pending solve is not undone by its write', async () => {
    const { session, doc, solver } = await editing(LINE);
    solver.hold();
    const added = session.addConstraint(constraint(LINE, { kind: 'fix', id: 'f', point: 'p' }));

    session.toggleConstruction([item('pq')]);
    solver.release();
    await added;
    await settle();

    const written = docData(doc, fid('s1'));
    expect(written.entities[2]).toMatchObject({ construction: true });
    expect(written.constraints.map((c) => c.id)).toEqual(['f']);
  });

  it('a queued job that throws synchronously does not block the next command', async () => {
    const { session, doc, solver } = await editing(LINE);
    const unhandled = catchUnhandledRejections();
    try {
      solver.hold();
      const added = session.addConstraint(constraint(LINE, { kind: 'fix', id: 'f', point: 'p' }));
      // Behind the pending solve the toggle waits in the queue; its job is not async.
      session.toggleConstruction([item('pq')]);
      const failure = new Error('subscriber failed');
      let thrown = false;
      session.state.subscribe(() => {
        const pq = session.state.get().entities[2];
        if (thrown || pq?.kind !== 'line' || pq.construction !== true) return;
        thrown = true;
        throw failure;
      });
      let done: boolean | 'pending' = 'pending';
      void session
        .addConstraint(constraint(LINE, { kind: 'horizontal', id: 'h', line: 'pq' }))
        .then((written) => {
          done = written;
        });

      solver.release();
      await settle();

      expect(await added).toBe(true);
      expect(done).toBe(true);
      const written = docData(doc, fid('s1'));
      expect(written.entities[2]).toMatchObject({ construction: true });
      expect(written.constraints.map((c) => c.id)).toEqual(['f', 'h']);
      // The toggle has no promise for the caller: its failure is not swallowed.
      expect(unhandled.reasons).toEqual([failure]);
    } finally {
      unhandled.stop();
    }
  });

  it('runs commands one after another, each on the data of the one before', async () => {
    const { session, solver, doc } = await editing(LINE);
    solver.hold();

    const first = session.addConstraint(constraint(LINE, { kind: 'fix', id: 'f', point: 'p' }));
    const second = session.addConstraint(
      constraint(LINE, { kind: 'horizontal', id: 'h', line: 'pq' }),
    );
    await settle();
    expect(laterCalls(solver.calls)).toHaveLength(1);

    solver.release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);

    expect(laterCalls(solver.calls)[1]?.constraints.map((c) => c.id)).toEqual(['f', 'h']);
    expect(docData(doc, fid('s1')).constraints.map((c) => c.id)).toEqual(['f', 'h']);
  });

  it('drops a result that arrives after closing', async () => {
    const { session, solver, applied } = await editing(LINE);
    solver.hold();
    const pending = session.addConstraint(constraint(LINE, { kind: 'fix', id: 'f', point: 'p' }));

    session.cancel();
    solver.release();

    expect(await pending).toBe(false);
    expect(applied).toEqual([]);
  });
});

describe('SketchSession.addGeometry checks its automatic constraints (M26)', () => {
  // A new line q→r continuing LINE with four automatic constraints; h and f are kept by the
  // last attempt (h required by the tool, f a fix).
  const NEW = data(
    [
      ...LINE.entities,
      { kind: 'point', id: 'r', x: 8, y: 1 },
      { kind: 'line', id: 'qr', p1: 'q', p2: 'r' },
    ],
    [
      { kind: 'horizontal', id: 'h', line: 'qr' },
      { kind: 'perpendicular', id: 'pp', a: 'pq', b: 'qr' },
      { kind: 'equal', id: 'eq', a: 'pq', b: 'qr' },
      { kind: 'fix', id: 'f', point: 'r' },
    ],
  );
  const ADD: SketchData = { entities: NEW.entities.slice(-2), constraints: NEW.constraints };
  const REQUIRED = { required: new Set([cid('h')]) };
  const idsOf = (d: SketchData | undefined) => d?.constraints.map((c) => c.id);

  it('a conflict solves again without the conflicting added constraints and writes', async () => {
    const { session, solver, doc } = await editing(LINE);
    // An old constraint in the list cannot be left out; only the added ones are.
    solver.next({ status: 'conflict', entities: null, conflicting: [cid('pp'), cid('old')] });

    expect(await session.addGeometry(ADD, REQUIRED)).toBe(true);

    expect(laterCalls(solver.calls).map(idsOf)).toEqual([
      ['h', 'pp', 'eq', 'f'],
      ['h', 'eq', 'f'],
    ]);
    expect(idsOf(docData(doc, fid('s1')))).toEqual(['h', 'eq', 'f']);
    expect(docData(doc, fid('s1')).entities.map((e) => e.id)).toEqual(['p', 'q', 'pq', 'r', 'qr']);
    expect(session.state.get().message).toBeNull();
  });

  it('fix and the required constraints stay in the retry even when conflicting', async () => {
    const { session, solver, doc } = await editing(LINE);
    solver.next({
      status: 'conflict',
      entities: null,
      conflicting: [cid('h'), cid('pp'), cid('f')],
    });

    expect(await session.addGeometry(ADD, REQUIRED)).toBe(true);

    expect(laterCalls(solver.calls).map(idsOf)).toEqual([
      ['h', 'pp', 'eq', 'f'],
      ['h', 'eq', 'f'],
    ]);
    expect(idsOf(docData(doc, fid('s1')))).toEqual(['h', 'eq', 'f']);
  });

  it('a second conflict keeps only fix and the required constraints', async () => {
    const { session, solver, doc } = await editing(LINE);
    solver.next({ status: 'conflict', entities: null, conflicting: [cid('pp')] });
    solver.next({ status: 'conflict', entities: null, conflicting: [cid('eq')] });

    expect(await session.addGeometry(ADD, REQUIRED)).toBe(true);

    expect(laterCalls(solver.calls).map(idsOf)).toEqual([
      ['h', 'pp', 'eq', 'f'],
      ['h', 'eq', 'f'],
      ['h', 'f'],
    ]);
    expect(idsOf(docData(doc, fid('s1')))).toEqual(['h', 'f']);
  });

  it('solves at most three times: a third conflict writes nothing', async () => {
    const { session, solver, applied } = await editing(LINE);
    for (let i = 0; i < 4; i++) {
      solver.next({ status: 'conflict', entities: null, conflicting: [cid('pp')] });
    }

    expect(await session.addGeometry(ADD, REQUIRED)).toBe(false);

    expect(laterCalls(solver.calls)).toHaveLength(3);
    expect(applied).toEqual([]);
    expect(session.state.get().message).toEqual({ key: 'sketch.conflict' });
  });

  it('a conflict naming no added constraint goes straight to fix and required', async () => {
    const { session, solver, doc } = await editing(LINE);
    solver.next({ status: 'conflict', entities: null, conflicting: [cid('old')] });

    expect(await session.addGeometry(ADD, REQUIRED)).toBe(true);

    expect(laterCalls(solver.calls).map(idsOf)).toEqual([
      ['h', 'pp', 'eq', 'f'],
      ['h', 'f'],
    ]);
    expect(idsOf(docData(doc, fid('s1')))).toEqual(['h', 'f']);
  });

  it('without required the last attempt keeps only fix', async () => {
    const { session, solver, doc } = await editing(LINE);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });

    expect(await session.addGeometry(ADD)).toBe(true);

    expect(laterCalls(solver.calls).map(idsOf)).toEqual([['h', 'pp', 'eq', 'f'], ['f']]);
    expect(idsOf(docData(doc, fid('s1')))).toEqual(['f']);
  });

  it('a conflict that leaving out changes nothing is rejected after one solve', async () => {
    const { session, solver, applied } = await editing(LINE);
    const onlyFixed: SketchData = {
      entities: ADD.entities,
      constraints: ADD.constraints.filter((c) => c.id === 'h' || c.id === 'f'),
    };
    solver.next({ status: 'conflict', entities: null, conflicting: [cid('old')] });

    expect(await session.addGeometry(onlyFixed, REQUIRED)).toBe(false);

    expect(laterCalls(solver.calls)).toHaveLength(1);
    expect(applied).toEqual([]);
    expect(session.state.get().message).toEqual({ key: 'sketch.conflict' });
  });

  it('the added constraints the retry finds redundant are left out', async () => {
    const { session, solver, doc } = await editing(LINE);
    solver.next({ status: 'conflict', entities: null, conflicting: [cid('pp')] });
    solver.next({ redundant: [cid('eq'), cid('h')] });

    expect(await session.addGeometry(ADD, REQUIRED)).toBe(true);

    expect(idsOf(docData(doc, fid('s1')))).toEqual(['f']);
  });

  it('a failed retry writes nothing and shows solverFailed', async () => {
    const { session, solver, applied } = await editing(LINE);
    solver.next({ status: 'conflict', entities: null, conflicting: [cid('pp')] });
    solver.next({ status: 'failed', entities: null, dof: null });

    expect(await session.addGeometry(ADD, REQUIRED)).toBe(false);

    expect(applied).toEqual([]);
    expect(session.state.get().message).toEqual({ key: 'sketch.solverFailed' });
  });
});

describe('SketchSession dragging', () => {
  it('keeps one solve running and one target waiting; the last target wins', async () => {
    const { session, solver, doc } = await editing(LINE);
    solver.hold();

    session.drag(eid('q'), [5, 5]);
    session.drag(eid('q'), [6, 6]);
    session.drag(eid('q'), [7, 7]);
    await settle();
    expect(laterCalls(solver.calls)).toHaveLength(1);

    solver.release();
    await session.endDrag();
    // The second solve is held again only if holding were on; release turned it off.
    expect(laterCalls(solver.calls).map((c) => c.drag)).toEqual([
      { point: 'q', to: [5, 5] },
      { point: 'q', to: [7, 7] },
    ]);
    expect(docData(doc, fid('s1')).entities[1]).toMatchObject({ x: 7, y: 7 });
  });

  it('a conflict while dragging is dropped silently', async () => {
    const { session, solver, applied } = await editing(LINE);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });

    session.drag(eid('q'), [5, 5]);
    await session.endDrag();

    expect(applied).toEqual([]);
    expect(session.state.get().message).toBeNull();
  });

  it('dragging waits for a command before it in the queue', async () => {
    const { session, solver } = await editing(LINE);
    solver.hold();
    const added = session.addConstraint(constraint(LINE, { kind: 'fix', id: 'f', point: 'p' }));

    session.drag(eid('q'), [5, 5]);
    await settle();
    expect(laterCalls(solver.calls)).toHaveLength(1);

    solver.release();
    await added;
    await session.endDrag();
    expect(laterCalls(solver.calls)[1]).toMatchObject({ drag: { point: 'q', to: [5, 5] } });
    expect(laterCalls(solver.calls)[1]?.constraints.map((c) => c.id)).toEqual(['f']);
  });

  it('endDrag without dragging settles at once', async () => {
    const { session } = await editing(LINE);
    await expect(session.endDrag()).resolves.toBeUndefined();
  });

  it('keeps busy until the last result of the drag', async () => {
    const { session, solver } = await editing(LINE);
    const seen: boolean[] = [];
    session.state.subscribe(() => {
      const { busy } = session.state.get();
      if (seen.at(-1) !== busy) seen.push(busy);
    });
    solver.hold();

    session.drag(eid('q'), [5, 5]);
    session.drag(eid('q'), [6, 6]);
    expect(session.state.get().busy).toBe(true);
    solver.release();
    await session.endDrag();
    await settle();

    expect(session.state.get().busy).toBe(false);
    // Never idle between the two solves of the drag.
    expect(seen).toEqual([true, false]);
  });
});

describe('SketchState.busy (D8)', () => {
  it('is false while the first solve runs, so Finish is enabled right after opening', async () => {
    const { sketches, solver } = setup({ features: [['s1', LINE]] });
    const registry = createActionRegistry({ mode: sketches.mode });
    createSketchActions({ registry, sketches, ids: createSequentialIdGenerator('c') });
    const finishEnabled = () =>
      registry.actions.get().find((a) => a.id === SKETCH_ACTION_IDS.finish)?.enabled;
    solver.hold();

    const session = sketches.edit(fid('s1'));

    expect(session.state.get()).toMatchObject({ status: 'solving', busy: false });
    expect(finishEnabled()).toBe(true);
    // A command waits behind the first solve: busy at once.
    const added = session.addGeometry(data([{ kind: 'point', id: 'r', x: 1, y: 1 }]));
    expect(session.state.get().busy).toBe(true);
    expect(finishEnabled()).toBe(false);
    solver.release();
    expect(await added).toBe(true);
    expect(session.state.get().busy).toBe(false);
    expect(finishEnabled()).toBe(true);
  });

  it('is true while a deferred toggle of construction waits', async () => {
    const { session, solver } = await editing(LINE);
    solver.hold();
    const added = session.addConstraint(constraint(LINE, { kind: 'fix', id: 'f', point: 'p' }));
    session.toggleConstruction([item('pq')]);
    let busyAtToggle: boolean | null = null;
    session.state.subscribe(() => {
      const { busy, entities } = session.state.get();
      const pq = entities[2];
      if (busyAtToggle === null && pq?.kind === 'line' && pq.construction === true) {
        busyAtToggle = busy;
      }
    });

    solver.release();
    await added;
    await settle();

    // The toggle still counts when it writes, after the solve before it is done.
    expect(busyAtToggle).toBe(true);
    expect(session.state.get().busy).toBe(false);
  });

  it('is true while a command waits for the solver and false once its promise settles', async () => {
    const { session, solver } = await editing(LINE);
    solver.hold();

    const added = session.addGeometry(data([{ kind: 'point', id: 'r', x: 1, y: 1 }]));
    expect(session.state.get().busy).toBe(true);
    solver.release();
    expect(await added).toBe(true);

    // At once, so Finish right after an awaited command is enabled.
    expect(session.state.get().busy).toBe(false);
  });

  it('stays true while a second command waits behind the first', async () => {
    const { session, solver } = await editing(LINE);
    solver.hold();
    const first = session.addGeometry(data([{ kind: 'point', id: 'r', x: 1, y: 1 }]));
    const second = session.addGeometry(data([{ kind: 'point', id: 's', x: 2, y: 2 }]));

    // The second solve starts once the first command is done; it stays held.
    solver.release();
    solver.hold();
    expect(await first).toBe(true);
    expect(session.state.get().busy).toBe(true);
    solver.release();
    expect(await second).toBe(true);

    expect(session.state.get().busy).toBe(false);
  });

  it('is false once the session is closed with a command still waiting', async () => {
    const { session, solver } = await editing(LINE);
    solver.hold();
    const added = session.addGeometry(data([{ kind: 'point', id: 'r', x: 1, y: 1 }]));

    session.cancel();

    expect(session.state.get().busy).toBe(false);
    solver.release();
    expect(await added).toBe(false);
  });
});

describe('SketchSession selection and panel rows', () => {
  it('select replaces, additive toggles, unknown ids do nothing', async () => {
    const { session } = await editing(rectangleData());

    session.select(item('ab'));
    session.select(item('h1'), { additive: true });
    expect(session.state.get().selection).toEqual(['ab', 'h1']);
    session.select(item('ab'), { additive: true });
    expect(session.state.get().selection).toEqual(['h1']);
    session.select(item('bc'));
    expect(session.state.get().selection).toEqual(['bc']);
    session.select(item('nope'));
    expect(session.state.get().selection).toEqual(['bc']);
    session.clearSelection();
    expect(session.state.get().selection).toEqual([]);
  });

  it('numbers the rows within their kind and marks the selected ones', async () => {
    const rect = rectangleData();
    const withDim = data(rect.entities, [
      ...rect.constraints,
      { kind: 'distance', id: 'w', a: 'a', b: 'b', value: 10 },
    ]);
    const { session } = await editing(withDim);
    session.select(item('h2'));

    expect(session.state.get().constraintRows).toEqual([
      { id: 'h1', kind: 'horizontal', n: 1, value: null, selected: false },
      { id: 'v1', kind: 'vertical', n: 1, value: null, selected: false },
      { id: 'h2', kind: 'horizontal', n: 2, value: null, selected: true },
      { id: 'v2', kind: 'vertical', n: 2, value: null, selected: false },
      { id: 'w', kind: 'distance', n: 1, value: 10, selected: false },
    ]);
  });

  it('keeps unchanged rows identical and emits nothing without a change', async () => {
    const { session } = await editing(rectangleData());
    const before = session.state.get();
    let emits = 0;
    session.state.subscribe(() => emits++);

    session.setHover(null);
    session.clearSelection();
    expect(emits).toBe(0);

    session.select(item('v1'));
    const after = session.state.get();
    expect(after.constraintRows[0]).toBe(before.constraintRows[0]);
    expect(after.constraintRows[1]).not.toBe(before.constraintRows[1]);
    expect(after.entities).toBe(before.entities);
    expect(Object.isFrozen(after)).toBe(true);
    expect(Object.isFrozen(after.selection)).toBe(true);
    expect(Object.isFrozen(after.constraintRows)).toBe(true);
  });

  it('lists the dimensions for the viewport in world coordinates of the plane', async () => {
    const rect = rectangleData();
    const withDim = data(rect.entities, [
      ...rect.constraints,
      { kind: 'distance', id: 'w', a: 'a', b: 'b', value: 10 },
    ]);
    const ctx = setup({ features: [['s1', withDim, ORIGIN_PLANE_IDS.xz]] });
    const session = ctx.sketches.edit(fid('s1'));
    await settle();
    const before = session.state.get();
    expect(before.dimensions).toHaveLength(1);
    expect(before.dimensions[0]).toMatchObject({
      id: 'w',
      kind: 'distance',
      value: 10,
      n: 1,
      selected: false,
      geometry: {
        kind: 'linear',
        from: planeMath.toWorld(XZ, [0, 0]),
        to: planeMath.toWorld(XZ, [10, 0]),
      },
    });

    session.select(item('h1'));
    expect(session.state.get().dimensions).toBe(before.dimensions);
    session.select(item('w'));
    expect(session.state.get().dimensions[0]?.selected).toBe(true);
  });

  it('shows invalid data as empty', () => {
    const ctx = setup();
    const session = ctx.sketches.create(planeRef(ORIGIN_PLANE_IDS.xy));
    ctx.editor.current.get()?.setParams({ entities: 'broken' });

    expect(session.state.get().entities).toEqual([]);
    expect(session.state.get().constraints).toEqual([]);
  });
});

describe('SketchState.glyphs (M25)', () => {
  /** The rectangle with a perpendicular of ab and bc and a distance of a and b. */
  const SKETCH = (() => {
    const rect = rectangleData();
    return data(rect.entities, [
      ...rect.constraints,
      { kind: 'perpendicular', id: 'perp', a: 'ab', b: 'bc' },
      { kind: 'distance', id: 'w', a: 'a', b: 'b', value: 10 },
    ]);
  })();

  const pairs = (session: SketchSession) =>
    session.state.get().glyphs.map((g) => [g.constraint, g.entity]);

  it('without a selection or a hover there are none', async () => {
    const { session } = await editing(SKETCH);

    expect(session.state.get().glyphs).toEqual([]);
  });

  it('a selected entity shows the glyphs of its constraints, at all their entities', async () => {
    const { session } = await editing(SKETCH);

    session.select(item('ab'));

    expect(pairs(session)).toEqual([
      ['h1', 'ab'],
      ['perp', 'ab'],
      ['perp', 'bc'],
    ]);
    const [h1] = session.state.get().glyphs;
    expect(h1).toMatchObject({ kind: 'horizontal', anchor: [5, 0, 0], slot: 0 });
  });

  it('a hovered entity shows its glyphs too', async () => {
    const { session } = await editing(SKETCH);

    session.select(item('ab'));
    session.setHover(item('cd'));

    expect(pairs(session)).toEqual([
      ['h1', 'ab'],
      ['h2', 'cd'],
      ['perp', 'ab'],
      ['perp', 'bc'],
    ]);
  });

  it('a selected or hovered constraint shows the glyphs at its entities and is marked', async () => {
    const { session } = await editing(SKETCH);

    session.select(item('perp'));
    expect(pairs(session)).toEqual([
      ['h1', 'ab'],
      ['v1', 'bc'],
      ['perp', 'ab'],
      ['perp', 'bc'],
    ]);
    expect(
      session.state
        .get()
        .glyphs.filter((g) => g.selected)
        .map((g) => g.entity),
    ).toEqual(['ab', 'bc']);

    session.clearSelection();
    session.setHover(item('v2'));
    expect(pairs(session)).toEqual([['v2', 'da']]);
    expect(session.state.get().glyphs[0]?.hover).toBe(true);
  });

  it('a selected or hovered curve shows the glyphs at its defining points too', async () => {
    const sketch = data(
      [
        { kind: 'point', id: 'p', x: 0, y: 0 },
        { kind: 'point', id: 'q', x: 4, y: 0 },
        { kind: 'point', id: 'r', x: 4, y: 0 },
        { kind: 'line', id: 'pq', p1: 'p', p2: 'q' },
        { kind: 'point', id: 'o', x: 9, y: 9 },
        { kind: 'circle', id: 'k', center: 'o', radius: 1 },
      ],
      [
        { kind: 'fix', id: 'fx', point: 'p' },
        { kind: 'coincident', id: 'co', a: 'q', b: 'r' },
        { kind: 'fix', id: 'fo', point: 'o' },
      ],
    );
    const { session } = await editing(sketch);

    session.select(item('pq'));
    expect(pairs(session)).toEqual([
      ['fx', 'p'],
      ['co', 'q'],
    ]);
    session.clearSelection();
    session.setHover(item('k'));
    expect(pairs(session)).toEqual([['fo', 'o']]);
  });

  it('a selected dimension shows no glyphs', async () => {
    const { session } = await editing(SKETCH);

    session.select(item('w'));

    expect(session.state.get().glyphs).toEqual([]);
  });

  it('showAllConstraints shows the glyphs of every geometric constraint at once', async () => {
    const { session, sketches } = await editing(SKETCH);

    sketches.setShowAllConstraints(true);
    expect(pairs(session)).toEqual([
      ['h1', 'ab'],
      ['v1', 'bc'],
      ['h2', 'cd'],
      ['v2', 'da'],
      ['perp', 'ab'],
      ['perp', 'bc'],
    ]);
    sketches.setShowAllConstraints(false);
    expect(session.state.get().glyphs).toEqual([]);
  });

  it('keeps the array while nothing about the glyphs changes', async () => {
    const { session } = await editing(SKETCH);
    session.select(item('ab'));
    const before = session.state.get().glyphs;

    session.select(item('w'), { additive: true });

    expect(session.state.get().glyphs).toBe(before);
  });

  it('a closed session stops following the switch', async () => {
    const { session, sketches } = await editing(SKETCH);
    session.cancel();
    const after = session.state.get();

    sketches.setShowAllConstraints(true);

    expect(session.state.get()).toBe(after);
  });
});

describe('SketchSession drawing', () => {
  it('draws the sketch with the origin point under sketch-edit', async () => {
    const { session, viewport } = await editing(LINE);

    const drawing = viewport.sketchDrawings.get(EDIT_SKETCH_DRAWING_ID);

    expect(drawing?.plane).toBe(session.plane.get());
    expect(drawing?.curves.map((c) => [c.id, c.style])).toEqual([['pq', 'normal']]);
    expect(drawing?.points.map((p) => [p.id, p.style])).toEqual([
      ['p', 'normal'],
      ['q', 'normal'],
      [ORIGIN_POINT_ID, 'normal'],
    ]);
  });

  it('redraws after a change of the data', async () => {
    const { session, viewport } = await editing(LINE);

    await session.remove([item('pq')]);

    expect(viewport.sketchDrawings.get(EDIT_SKETCH_DRAWING_ID)?.curves).toEqual([]);
  });

  it('styles selected, hovered, construction and fully defined items', async () => {
    const sketch = data([
      ...LINE.entities,
      { kind: 'point', id: 'r', x: 9, y: 9 },
      { kind: 'line', id: 'qr', p1: 'q', p2: 'r', construction: true },
    ]);
    const ctx = setup({ features: [['s1', sketch]] });
    ctx.solver.next({ dof: 0 });
    const session = ctx.sketches.edit(fid('s1'));
    await settle();

    session.select(item('p'));
    session.setHover(item('pq'));
    const drawing = ctx.viewport.sketchDrawings.get(EDIT_SKETCH_DRAWING_ID);

    expect(drawing?.curves.map((c) => [c.id, c.style])).toEqual([
      ['pq', 'hover'],
      ['qr', 'construction'],
    ]);
    expect(drawing?.points.map((p) => [p.id, p.style])).toEqual([
      ['p', 'selected'],
      ['q', 'defined'],
      ['r', 'defined'],
      [ORIGIN_POINT_ID, 'normal'],
    ]);
    session.select(item('pq'));
    const selected = ctx.viewport.sketchDrawings.get(EDIT_SKETCH_DRAWING_ID);
    expect(selected?.curves[0]?.style).toBe('selected');
  });

  it('a hovered constraint highlights its entities unless they are selected (M25)', async () => {
    const sketch = rectangleData();
    const ctx = setup({ features: [['s1', sketch]] });
    const session = ctx.sketches.edit(fid('s1'));
    await settle();
    const styles = () =>
      Object.fromEntries(
        ctx.viewport.sketchDrawings
          .get(EDIT_SKETCH_DRAWING_ID)
          ?.curves.map((c) => [c.id, c.style]) ?? [],
      );

    session.select(item('ab'));
    session.setHover(item('h1'));
    expect(styles()).toEqual({ ab: 'selected', bc: 'normal', cd: 'normal', da: 'normal' });

    session.setHover(item('v1'));
    expect(styles()).toEqual({ ab: 'selected', bc: 'hover', cd: 'normal', da: 'normal' });

    session.select(item('h2'));
    session.setHover(null);
    expect(styles()).toEqual({ ab: 'normal', bc: 'normal', cd: 'selected', da: 'normal' });

    session.setHover(item('h2'));
    expect(styles()).toEqual({ ab: 'normal', bc: 'normal', cd: 'selected', da: 'normal' });
  });

  it('removes the drawing after closing', async () => {
    const { session, viewport } = await editing(LINE);

    session.finish();

    expect(viewport.sketchDrawings.has(EDIT_SKETCH_DRAWING_ID)).toBe(false);
  });
});

describe('SketchSession plane (M21)', () => {
  it('a new plane reference moves the plane, redraws and keeps the 2D entities', async () => {
    const { session, editor, viewport } = await editing(LINE);
    const planes: Plane[] = [];
    session.plane.subscribe(() => planes.push(session.plane.get()));
    const before = session.state.get().entities;

    editor.current.get()?.setParam('plane', [planeRef(ORIGIN_PLANE_IDS.xz)]);

    expect(session.plane.get()).toBe(XZ);
    expect(planes).toEqual([XZ]);
    expect(viewport.sketchDrawings.get(EDIT_SKETCH_DRAWING_ID)?.plane).toBe(XZ);
    expect(session.state.get().entities).toBe(before);
  });

  it('a face reference moves the plane to the face', async () => {
    const { session, editor } = await editing(LINE);
    editor.current.get()?.setParam('plane', [TOP_FACE]);
    expect(session.plane.get()).toBe(TOP);
  });

  it('the dimensions of the viewport follow the new plane', async () => {
    const sketch = data(LINE.entities, [{ kind: 'distance', id: 'd', a: 'p', b: 'q', value: 4 }]);
    const { session, editor } = await editing(sketch);
    expect(session.state.get().dimensions[0]?.geometry).toMatchObject({ to: [4, 1, 0] });

    editor.current.get()?.setParam('plane', [planeRef(ORIGIN_PLANE_IDS.xz)]);

    // XZ: x stays +X, y of the plane is +Z.
    expect(session.state.get().dimensions[0]?.geometry).toMatchObject({ to: [4, 0, 1] });
  });

  it('planeField shows the plane param for the panel and follows its value', async () => {
    const { session, editor } = await editing(LINE);
    expect(session.state.get().planeField).toEqual({
      label: 'sketch.plane',
      text: { key: 'origin.plane.xy', params: {} },
      active: false,
      invalid: false,
    });
    const before = session.state.get().planeField;
    await session.remove([item('pq')]);
    // Unchanged field, same object.
    expect(session.state.get().planeField).toBe(before);

    editor.current.get()?.setParam('plane', [planeRef(ORIGIN_PLANE_IDS.xz)]);
    expect(session.state.get().planeField?.text).toEqual({ key: 'origin.plane.xz', params: {} });
  });

  it('planeField without a plane: no text and invalid', async () => {
    const { session, editor } = await editing(LINE);
    editor.current.get()?.setParam('plane', []);
    expect(session.state.get().planeField).toMatchObject({ text: null, invalid: true });
  });

  it('pickPlane focuses the plane param; cancelPlanePick ends it once', async () => {
    const { session, editor } = await editing(LINE);
    session.pickPlane();
    expect(editor.current.get()?.state.get().activeRefParam).toBe('plane');
    expect(session.state.get().planeField?.active).toBe(true);

    expect(session.cancelPlanePick()).toBe(true);
    expect(editor.current.get()?.state.get().activeRefParam).toBeNull();
    expect(session.state.get().planeField?.active).toBe(false);
    // Not picking: nothing to end, the caller leaves the key alone.
    expect(session.cancelPlanePick()).toBe(false);
  });

  it('a reference that does not resolve keeps the plane; other changes do not touch it', async () => {
    const { session, editor, viewport } = await editing(LINE);
    const planes: Plane[] = [];
    session.plane.subscribe(() => planes.push(session.plane.get()));

    editor.current.get()?.setParam('plane', [topoRef('b1/body', 'b1/face:round')]);
    await session.remove([item('pq')]);

    expect(session.plane.get()).toBe(XY);
    expect(planes).toEqual([]);
    expect(viewport.sketchDrawings.get(EDIT_SKETCH_DRAWING_ID)?.plane).toBe(XY);
  });
});

describe('SketchSession finish and cancel', () => {
  it('a new sketch is one log entry batch[feature.add, feature.setParams]', async () => {
    const { sketches, log } = setup();
    const session = sketches.create(planeRef(ORIGIN_PLANE_IDS.xy));
    const added = data([
      { kind: 'point', id: 'p', x: 0, y: 0 },
      { kind: 'point', id: 'q', x: 4, y: 0 },
    ]);
    await session.addGeometry(added);
    const more = data([...added.entities, { kind: 'line', id: 'pq', p1: 'p', p2: 'q' }]);
    await session.addGeometry({ entities: more.entities.slice(-1), constraints: [] });

    session.finish();

    const entries = log.entries();
    expect(entries).toHaveLength(1);
    const ops = (entries[0]?.op as BatchOp).ops; // the entry of a new feature is a batch
    expect(ops.map((op) => op.type)).toEqual(['feature.add', 'feature.setParams']);
    expect(ops[1]).toMatchObject({ params: { entities: more.entities } });
  });

  it('editing a sketch is one feature.setParams entry', async () => {
    const { session, log } = await editing(LINE);
    await session.remove([item('pq')]);
    await session.addConstraint(constraint(LINE, { kind: 'fix', id: 'f', point: 'p' }));

    session.finish();

    expect(log.entries().map((e) => e.op.type)).toEqual(['feature.setParams']);
  });

  it('finish closes the session and returns to the model mode', async () => {
    const { session, sketches, editor } = await editing(LINE);
    const modes: string[] = [];
    sketches.mode.subscribe(() => modes.push(sketches.mode.get()));

    session.finish();

    expect(session.state.get().open).toBe(false);
    expect(sketches.current.get()).toBeNull();
    expect(editor.current.get()).toBeNull();
    expect(modes).toEqual(['model']);
  });

  it('cancel leaves the log unchanged and removes a new sketch', async () => {
    const { sketches, log, doc } = setup();
    const session = sketches.create(planeRef(ORIGIN_PLANE_IDS.xy));
    await session.addGeometry(data([{ kind: 'point', id: 'p', x: 1, y: 1 }]));

    session.cancel();

    expect(log.entries()).toEqual([]);
    expect(doc.studio.features).toEqual([]);
    expect(sketches.mode.get()).toBe('model');
  });

  it('closes when the feature session closes otherwise', async () => {
    const { session, sketches, editor } = await editing(LINE);

    editor.current.get()?.cancel();

    expect(session.state.get().open).toBe(false);
    expect(sketches.current.get()).toBeNull();
  });

  it('every command after closing throws at once', async () => {
    const { session } = await editing(LINE);
    session.finish();
    const commands: ((s: SketchSession) => unknown)[] = [
      (s) => s.addGeometry(LINE),
      (s) => s.addConstraint(constraint(LINE, { kind: 'fix', id: 'f', point: 'p' })),
      (s) => s.setDimension(cid('d'), 1),
      (s) => s.remove([]),
      (s) => {
        s.toggleConstruction([]);
      },
      (s) => {
        s.drag(eid('p'), [0, 0]);
      },
      (s) => s.endDrag(),
      (s) => {
        s.setHover(null);
      },
      (s) => {
        s.select(item('p'));
      },
      (s) => {
        s.clearSelection();
      },
      (s) => {
        s.clearEditingDimension();
      },
      (s) => {
        s.finish();
      },
      (s) => {
        s.cancel();
      },
    ];
    for (const command of commands) expect(() => command(session)).toThrow();
  });

  it('a new session can be opened after closing', async () => {
    const { session, sketches } = await editing(LINE);
    session.cancel();
    expect(sketches.edit(fid('s1'))).toBe(sketches.current.get());
  });

  it.each(['finish', 'cancel'] as const)(
    'a state subscriber that throws on %s still cleans up; its error goes on',
    async (end) => {
      const { session, sketches, editor, viewport } = await editing(LINE);
      session.state.subscribe(() => {
        if (!session.state.get().open) throw new Error('subscriber failed');
      });

      expect(() => {
        session[end]();
      }).toThrow('subscriber failed');

      expect(session.state.get().open).toBe(false);
      expect(viewport.sketchDrawings.has(EDIT_SKETCH_DRAWING_ID)).toBe(false);
      expect(sketches.current.get()).toBeNull();
      expect(sketches.mode.get()).toBe('model');
      expect(editor.current.get()).toBeNull();
      expect(sketches.edit(fid('s1'))).toBe(sketches.current.get());
    },
  );

  it('a viewport that throws on removing the drawing still leaves the sketch mode', async () => {
    const { session, sketches, viewport } = await editing(LINE);
    vi.spyOn(viewport.sketches, 'remove').mockImplementation(() => {
      throw new Error('viewport failed');
    });

    expect(() => {
      session.cancel();
    }).toThrow('viewport failed');

    expect(sketches.current.get()).toBeNull();
    expect(sketches.mode.get()).toBe('model');
  });

  it('a subscriber of current that throws on closing still returns to the model mode', async () => {
    const { session, sketches } = await editing(LINE);
    sketches.current.subscribe(() => {
      if (sketches.current.get() === null) throw new Error('subscriber failed');
    });

    expect(() => {
      session.finish();
    }).toThrow('subscriber failed');

    expect(sketches.current.get()).toBeNull();
    expect(sketches.mode.get()).toBe('model');
  });
});
