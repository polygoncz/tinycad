import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator, plane as planeMath } from '@/core';
import type { Plane } from '@/core';
import {
  ORIGIN_PLANES,
  ORIGIN_PLANE_IDS,
  createFeatureSchemaRegistry,
  validateAgainstSchema,
} from '@/document';
import type { FeatureId, FeatureSchema, ParamSchema } from '@/document';
import { aFeature } from '@/document/testing';
import type { Operation } from '@/ops';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, parseSketchData } from '@/sketch';
import type {
  SketchConstraintDraft,
  SketchConstraintId,
  SketchData,
  SketchEntityId,
} from '@/sketch';
import { createFakeSolver } from '@/sketch/testing';
import { createFeatureEditor } from '@/interaction';
import { FakeViewport } from '@/interaction/testing';
import { createSketchEditor } from '@/sketcher/sketch-editor';

// The session's part of dimensions (spec 12, "Kóty (M28)"): the preview of the dimension tool and
// dragging a dimension label; and the inference preview of the drawing tools (M26). The rest of
// the session is tested in sketch-editor.test.ts.

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

// Test ids are trusted.
const fid = (id: string): FeatureId => id as FeatureId;
const eid = (id: string): SketchEntityId => id as SketchEntityId;
const cid = (id: string): SketchConstraintId => id as SketchConstraintId;

/** Valid sketch data from plain values (parse brands the ids). */
function data(entities: readonly unknown[], constraints: readonly unknown[] = []): SketchData {
  const parsed = parseSketchData(entities, constraints);
  if (!parsed.ok) throw new Error(`invalid test data ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

/** The line pq (0,0)–(10,0) with its distance d and the circle k of radius 2 around (20, 0). */
const SKETCH = data(
  [
    { kind: 'point', id: 'p', x: 0, y: 0 },
    { kind: 'point', id: 'q', x: 10, y: 0 },
    { kind: 'line', id: 'pq', p1: 'p', p2: 'q' },
    { kind: 'point', id: 'c', x: 20, y: 0 },
    { kind: 'circle', id: 'k', center: 'c', radius: 2 },
  ],
  [
    { kind: 'distance', id: 'd', a: 'p', b: 'q', value: 10 },
    { kind: 'horizontal', id: 'h', line: 'pq' },
  ],
);

/** An open session on the sketch 's1' (on `plane`), after the first solve. */
async function editing(plane: Plane = XY) {
  const schemas = createFeatureSchemaRegistry();
  schemas.register(SKETCH_SCHEMA);
  const feature = aFeature<Record<string, unknown>>({
    id: 's1',
    name: 'Sketch s1',
    type: SKETCH_FEATURE_TYPE,
    params: {
      plane: [{ kind: 'plane', plane: ORIGIN_PLANE_IDS.xy }],
      entities: SKETCH.entities,
      constraints: SKETCH.constraints,
    },
  });
  const ops = anOpsSession({ schemas, features: [feature] });
  const editor = createFeatureEditor({
    doc: ops.doc,
    ops: ops.dispatcher,
    schemas,
    ids: createSequentialIdGenerator('f'),
    translate: (key) => key,
  });
  const solver = createFakeSolver();
  const viewport = new FakeViewport();
  const sketches = createSketchEditor({
    features: editor,
    solver,
    viewport,
    resolvePlane: () => plane,
    planeOfSketch: () => plane,
  });
  const applied: Operation[] = [];
  ops.dispatcher.events.on('applied', ({ op }) => applied.push(op));
  const session = sketches.edit(fid('s1'));
  await settle();
  return { ...ops, solver, viewport, session, applied };
}

const [XY, XZ] = ORIGIN_PLANES.map((p) => p.plane) as [Plane, Plane, Plane]; // a fixed table of three

/** Lets the solver answers (microtasks) and the queue settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The constraints of 's1' in the document. */
function docConstraints(doc: ReturnType<typeof anOpsSession>['doc']): unknown {
  const params = doc.feature(fid('s1'))?.params as Record<string, unknown> | undefined; // a sketch feature
  return params?.constraints;
}

const DRAFT: SketchConstraintDraft = {
  kind: 'diameter',
  curve: eid('k'),
  value: 4,
  placement: { kind: 'radial', angle: 0, distance: 3 },
};

describe('SketchSession.previewDimension', () => {
  it('adds the preview view last, neither solved nor written', async () => {
    const { session, solver, applied } = await editing();
    const calls = solver.calls.length;

    session.previewDimension(DRAFT);

    const dims = session.state.get().dimensions;
    expect(dims.map((d) => d.id)).toEqual(['d', '__preview']);
    expect(dims[1]).toMatchObject({
      kind: 'diameter',
      value: 4,
      n: 0,
      selected: false,
      preview: true,
      placement: DRAFT.placement,
    });
    expect(session.state.get().constraints.map((c) => c.id)).toEqual(['d', 'h']);
    expect(solver.calls).toHaveLength(calls);
    expect(applied).toEqual([]);
  });

  it('null removes it', async () => {
    const { session } = await editing();
    session.previewDimension(DRAFT);
    session.previewDimension(null);

    expect(session.state.get().dimensions.map((d) => d.id)).toEqual(['d']);
  });

  it('writing a dimension clears it', async () => {
    const { session } = await editing();
    session.previewDimension(DRAFT);

    const written = session.addConstraint({ ...DRAFT, id: cid('k1') });
    expect(session.state.get().dimensions.some((d) => d.preview === true)).toBe(false);
    expect(await written).toBe(true);
    expect(session.state.get().dimensions.map((d) => d.id)).toEqual(['d', 'k1']);
  });
});

describe('SketchSession.moveDimension and endMoveDimension', () => {
  it('a move holds the new placement in the state only: no solver, no write', async () => {
    const { session, solver, applied, doc } = await editing();
    const calls = solver.calls.length;

    // The top view of FakeViewport: px = XY of the plane; above the middle (5, 0) by 3.
    session.moveDimension(cid('d'), 5, 3);

    const placement = { kind: 'linear', offset: 3, along: 0 };
    expect(session.state.get().constraints[0]).toMatchObject({ id: 'd', placement });
    expect(session.state.get().dimensions[0]?.placement).toEqual(placement);
    expect(session.state.get().dimensions[0]?.geometry).toMatchObject({
      lineFrom: [0, 3, 0],
      lineTo: [10, 3, 0],
    });
    expect(solver.calls).toHaveLength(calls);
    expect(applied).toEqual([]);
    expect(docConstraints(doc)).toEqual(SKETCH.constraints);
  });

  it('the cursor goes through screenToRay into the plane', async () => {
    const { session, viewport } = await editing();
    // A ray from above, shifted by (1, 2) against the px.
    viewport.setScreenToRay((x, y) => ({ origin: [x + 1, y + 2, 5], direction: [0, 0, -1] }));

    session.moveDimension(cid('d'), 6, 1);

    expect(session.state.get().dimensions[0]?.placement).toEqual({
      kind: 'linear',
      offset: 3,
      along: 2,
    });
  });

  it('endMoveDimension writes the placement in one setParams without the solver', async () => {
    const { session, solver, applied, doc } = await editing();
    const calls = solver.calls.length;
    session.moveDimension(cid('d'), 5, 3);
    session.moveDimension(cid('d'), 5, 4);
    session.moveDimension(cid('d'), 7, 5);

    session.endMoveDimension();
    await settle();

    expect(applied.map((op) => op.type)).toEqual(['feature.setParams']);
    expect(solver.calls).toHaveLength(calls);
    expect(docConstraints(doc)).toEqual([
      { ...SKETCH.constraints[0], placement: { kind: 'linear', offset: 5, along: 2 } },
      SKETCH.constraints[1],
    ]);
    expect(session.state.get().constraints[0]).toMatchObject({
      placement: { kind: 'linear', offset: 5, along: 2 },
    });
  });

  it('without a move endMoveDimension writes nothing', async () => {
    const { session, applied } = await editing();

    session.endMoveDimension();
    await settle();

    expect(applied).toEqual([]);
  });

  it('a second end after the write writes nothing more', async () => {
    const { session, applied } = await editing();
    session.moveDimension(cid('d'), 5, 3);
    session.endMoveDimension();
    session.endMoveDimension();
    await settle();

    expect(applied).toHaveLength(1);
  });

  it('an unknown id or a geometric constraint is ignored', async () => {
    const { session } = await editing();
    const before = session.state.get();

    session.moveDimension(cid('h'), 5, 3);
    session.moveDimension(cid('nope'), 5, 3);

    expect(session.state.get()).toBe(before);
  });

  it('behind a pending solve the write waits its turn and survives it', async () => {
    const { session, solver, doc } = await editing();
    solver.hold();
    void session.setDimension(cid('d'), 12);
    session.moveDimension(cid('d'), 5, 3);
    session.endMoveDimension();
    // The pending solve still shows the moved placement.
    expect(session.state.get().constraints[0]).toMatchObject({
      placement: { kind: 'linear', offset: 3, along: 0 },
    });

    solver.release();
    await settle();

    expect(docConstraints(doc)).toEqual([
      expect.objectContaining({
        id: 'd',
        value: 12,
        placement: { kind: 'linear', offset: 3, along: 0 },
      }),
      SKETCH.constraints[1],
    ]);
  });
});

describe('SketchSession.setInferencePreview (M26)', () => {
  const GUIDE = { axis: 'v', from: [10, 0], to: [10, 5] } as const;

  it('shows the kinds at the anchor in the world and draws the guides, neither solved nor written', async () => {
    const { session, solver, viewport, applied } = await editing(XZ);
    const calls = solver.calls.length;

    session.setInferencePreview({
      at: [10, 5],
      kinds: ['vAlign', 'pointOnCurve'],
      guides: [GUIDE],
    });

    expect(session.state.get().inference).toEqual({
      anchor: planeMath.toWorld(XZ, [10, 5]),
      kinds: ['vAlign', 'pointOnCurve'],
    });
    expect(viewport.overlayShapes.get('sketch-guides')).toEqual([
      {
        kind: 'lines',
        points: [planeMath.toWorld(XZ, [10, 0]), planeMath.toWorld(XZ, [10, 5])],
        style: 'construction',
      },
    ]);
    expect(solver.calls.length).toBe(calls);
    expect(applied).toEqual([]);
  });

  it('null removes the preview and the guides', async () => {
    const { session, viewport } = await editing();
    session.setInferencePreview({ at: [10, 5], kinds: ['vAlign'], guides: [GUIDE] });

    session.setInferencePreview(null);

    expect(session.state.get().inference).toBeNull();
    expect(viewport.overlayShapes.has('sketch-guides')).toBe(false);
  });

  it('a preview without kinds is no inference, without guides no overlay', async () => {
    const { session, viewport } = await editing();
    session.setInferencePreview({ at: [10, 5], kinds: ['fix'], guides: [GUIDE] });

    session.setInferencePreview({ at: [10, 5], kinds: [], guides: [] });

    expect(session.state.get().inference).toBeNull();
    expect(viewport.overlayShapes.has('sketch-guides')).toBe(false);
  });

  it('an unchanged preview publishes no new state; a moved one does not redraw the sketch', async () => {
    const { session, viewport } = await editing();
    session.setInferencePreview({ at: [10, 5], kinds: ['fix'], guides: [] });
    const before = session.state.get();
    const drawing = viewport.sketchDrawings.get('sketch-edit');

    session.setInferencePreview({ at: [10, 5], kinds: ['fix'], guides: [] });
    expect(session.state.get()).toBe(before);

    session.setInferencePreview({ at: [11, 5], kinds: ['fix'], guides: [] });
    expect(session.state.get()).not.toBe(before);
    expect(viewport.sketchDrawings.get('sketch-edit')).toBe(drawing);
  });

  it('closing the session removes the preview and the guides', async () => {
    const { session, viewport } = await editing();
    session.setInferencePreview({ at: [10, 5], kinds: ['vAlign'], guides: [GUIDE] });

    session.cancel();

    expect(session.state.get().inference).toBeNull();
    expect(viewport.overlayShapes.has('sketch-guides')).toBe(false);
  });
});
