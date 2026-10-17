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
import { SKETCH_FEATURE_TYPE, parseSketchData, patternCopies } from '@/sketch';
import type {
  Curve2,
  CurveHit,
  SketchConstraintDraft,
  SketchConstraintId,
  SketchData,
  SketchEntityId,
  SketchGeometry,
  TextOutliner,
} from '@/sketch';
import {
  createFakeSketchGeometry,
  createFakeSolver,
  createFakeTextOutliner,
  textData,
} from '@/sketch/testing';
import { createFeatureEditor } from '@/interaction';
import { FakeViewport } from '@/interaction/testing';
import { createSketchEditor } from '@/sketcher/sketch-editor';

// The session's part of dimensions (spec 12, "Kóty (M28)"): the preview of the dimension tool and
// dragging a dimension label; the inference preview of the drawing tools (M26); and the pattern
// copies after a solve (M36). The rest of the session is tested in sketch-editor.test.ts.

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
async function editing(
  plane: Plane = XY,
  opts: {
    readonly sketch?: SketchData;
    readonly geometry?: SketchGeometry;
    readonly text?: TextOutliner;
  } = {},
) {
  const sketch = opts.sketch ?? SKETCH;
  const schemas = createFeatureSchemaRegistry();
  schemas.register(SKETCH_SCHEMA);
  const feature = aFeature<Record<string, unknown>>({
    id: 's1',
    name: 'Sketch s1',
    type: SKETCH_FEATURE_TYPE,
    params: {
      plane: [{ kind: 'plane', plane: ORIGIN_PLANE_IDS.xy }],
      entities: sketch.entities,
      constraints: sketch.constraints,
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
    geometry: opts.geometry ?? createFakeSketchGeometry(),
    text: opts.text ?? createFakeTextOutliner(),
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

describe('SketchSession.setNumericInput (M32)', () => {
  const FIELD = {
    id: 'length',
    kind: 'length',
    text: '50',
    typed: true,
    locked: false,
    valid: true,
    active: true,
  } as const;

  it('shows the fields at the anchor in the world, neither solved nor written nor redrawn', async () => {
    const { session, solver, viewport, applied } = await editing(XZ);
    const calls = solver.calls.length;
    const drawing = viewport.sketchDrawings.get('sketch-edit');

    session.setNumericInput({ at: [10, 5], fields: [FIELD] });

    expect(session.state.get().numericInput).toEqual({
      anchor: planeMath.toWorld(XZ, [10, 5]),
      fields: [FIELD],
    });
    expect(solver.calls.length).toBe(calls);
    expect(applied).toEqual([]);
    expect(viewport.sketchDrawings.get('sketch-edit')).toBe(drawing);
  });

  it('null or no fields is no input', async () => {
    const { session } = await editing();
    session.setNumericInput({ at: [10, 5], fields: [FIELD] });
    session.setNumericInput(null);
    expect(session.state.get().numericInput).toBeNull();

    session.setNumericInput({ at: [10, 5], fields: [] });
    expect(session.state.get().numericInput).toBeNull();
  });

  it('an unchanged input publishes no new state; a changed text does', async () => {
    const { session } = await editing();
    session.setNumericInput({ at: [10, 5], fields: [FIELD] });
    const before = session.state.get();

    session.setNumericInput({ at: [10, 5], fields: [{ ...FIELD }] });
    expect(session.state.get()).toBe(before);

    session.setNumericInput({ at: [10, 5], fields: [{ ...FIELD, text: '5' }] });
    expect(session.state.get()).not.toBe(before);
    expect(session.state.get().numericInput?.fields[0]?.text).toBe('5');
  });

  it('closing the session removes the input', async () => {
    const { session } = await editing();
    session.setNumericInput({ at: [10, 5], fields: [FIELD] });

    session.cancel();

    expect(session.state.get().numericInput).toBeNull();
  });
});

// ---- M33: the intersections of the curves, the crossing points and rewrite ----

/** A call of SketchGeometry.intersections the test answers by hand. */
interface IntersectionsCall {
  readonly curves: readonly Curve2[];
  readonly resolve: (hits: readonly CurveHit[]) => void;
  readonly reject: (error: Error) => void;
}

/** A SketchGeometry whose intersections wait for the test; segment is not used. */
function controlledGeometry(): { geometry: SketchGeometry; calls: IntersectionsCall[] } {
  const calls: IntersectionsCall[] = [];
  const geometry: SketchGeometry = {
    intersections: (curves) =>
      new Promise((resolve, reject) => {
        calls.push({ curves, resolve, reject });
      }),
    segment: () => Promise.reject(new Error('segment is not used here')),
    fillet: () => Promise.reject(new Error('fillet is not used here')),
    offset: () => Promise.reject(new Error('offset is not used here')),
  };
  return { geometry, calls };
}

function hit(
  a: string,
  b: string,
  point: readonly [number, number],
  extra: Partial<CurveHit> = {},
): CurveHit {
  return { a, b, point, ta: 0, tb: 0, ...extra };
}

/** The shapes of the crossing overlay, or undefined without it. */
function crossings(viewport: FakeViewport): unknown {
  return viewport.overlayShapes.get('sketch-crossings');
}

/** The crossing overlay with the points in plane coordinates. */
function warningPoints(plane: Plane, points: readonly (readonly [number, number])[]): unknown {
  return [
    { kind: 'points', points: points.map((p) => planeMath.toWorld(plane, p)), style: 'warning' },
  ];
}

/**
 * The line ab (0,0)–(10,0), the line cd (5,−5)–(5,5) crossing it in (5,0), the line be from the
 * end b of ab to (10,5) and the construction line fg (2,−1)–(2,1) crossing ab in (2,0).
 */
const CROSSED = data([
  { kind: 'point', id: 'a', x: 0, y: 0 },
  { kind: 'point', id: 'b', x: 10, y: 0 },
  { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
  { kind: 'point', id: 'c', x: 5, y: -5 },
  { kind: 'point', id: 'd', x: 5, y: 5 },
  { kind: 'line', id: 'cd', p1: 'c', p2: 'd' },
  { kind: 'point', id: 'e', x: 10, y: 5 },
  { kind: 'line', id: 'be', p1: 'b', p2: 'e' },
  { kind: 'point', id: 'f', x: 2, y: -1 },
  { kind: 'point', id: 'g', x: 2, y: 1 },
  { kind: 'line', id: 'fg', p1: 'f', p2: 'g', construction: true },
]);

describe('SketchSession.hits (M33)', () => {
  it('asks for the intersections of all curves on opening, construction ones too', async () => {
    const { geometry, calls } = controlledGeometry();
    await editing(XY, { sketch: CROSSED, geometry });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.curves.map((c) => c.id)).toEqual(['ab', 'cd', 'be', 'fg']);
    expect(calls[0]?.curves[0]).toEqual({ kind: 'line', from: [0, 0], to: [10, 0], id: 'ab' });
  });

  it('is null before the answer, then the answer for the current data', async () => {
    const { geometry, calls } = controlledGeometry();
    const { session } = await editing(XY, { sketch: CROSSED, geometry });
    expect(session.hits()).toBeNull();

    const hits = [hit('ab', 'cd', [5, 0])];
    calls[0]?.resolve(hits);
    await settle();

    expect(session.hits()).toEqual(hits);
  });

  it('a write of the entities asks again; until the answer hits() is null', async () => {
    const { geometry, calls } = controlledGeometry();
    const { session } = await editing(XY, { sketch: CROSSED, geometry });
    calls[0]?.resolve([hit('ab', 'cd', [5, 0])]);
    await settle();

    expect(await session.remove([eid('fg')])).toBe(true);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.curves.map((c) => c.id)).toEqual(['ab', 'cd', 'be']);
    expect(session.hits()).toBeNull();
    calls[1]?.resolve([]);
    await settle();
    expect(session.hits()).toEqual([]);
  });

  it('the last request wins: an older answer is dropped', async () => {
    const { geometry, calls } = controlledGeometry();
    const { session } = await editing(XY, { sketch: CROSSED, geometry });
    await session.remove([eid('fg')]);
    const newer = [hit('ab', 'cd', [5, 0])];

    calls[0]?.resolve([hit('ab', 'fg', [2, 0])]);
    await settle();
    expect(session.hits()).toBeNull();

    calls[1]?.resolve(newer);
    await settle();
    expect(session.hits()).toEqual(newer);

    // Also when the older answer comes after the newer one.
    await session.remove([eid('be')]);
    await session.remove([eid('cd')]);
    calls[3]?.resolve([]);
    calls[2]?.resolve(newer);
    await settle();
    expect(session.hits()).toEqual([]);
  });

  it('a change of only the constraints does not ask again', async () => {
    const { geometry, calls } = controlledGeometry();
    const { session } = await editing(XY, { geometry });

    expect(await session.setDimension(cid('d'), 12)).toBe(true);

    expect(calls).toHaveLength(1);
  });

  it('an error of the port gives null', async () => {
    const { geometry, calls } = controlledGeometry();
    const { session } = await editing(XY, { sketch: CROSSED, geometry });

    calls[0]?.reject(new Error('kernel down'));
    await settle();

    expect(session.hits()).toBeNull();
  });
});

describe('SketchSession crossing points (M33, Q093)', () => {
  it('marks the crossings of non-construction curves, not their shared end points', async () => {
    const { viewport } = await editing(XZ, { sketch: CROSSED });

    expect(crossings(viewport)).toEqual(warningPoints(XZ, [[5, 0]]));
  });

  it('marks an end point of one curve on the inside of another (not shared by both)', async () => {
    const { geometry, calls } = controlledGeometry();
    const { viewport } = await editing(XY, { sketch: CROSSED, geometry });

    // A hand-made answer: cd passes through the end b of ab, which is no end of cd.
    calls[0]?.resolve([hit('ab', 'be', [10, 0]), hit('ab', 'cd', [10, 0])]);
    await settle();

    expect(crossings(viewport)).toEqual(warningPoints(XY, [[10, 0]]));
  });

  it('marks the ends of overlaps, also in a shared end point', async () => {
    const { geometry, calls } = controlledGeometry();
    const { viewport } = await editing(XY, { sketch: CROSSED, geometry });

    calls[0]?.resolve([hit('ab', 'be', [10, 0], { overlap: true })]);
    await settle();

    expect(crossings(viewport)).toEqual(warningPoints(XY, [[10, 0]]));
  });

  it('marks a self-intersection of a spline', async () => {
    const sketch = data([
      { kind: 'point', id: 'p0', x: 0, y: 0 },
      { kind: 'point', id: 'p1', x: 10, y: 10 },
      { kind: 'point', id: 'p2', x: 10, y: 0 },
      { kind: 'point', id: 'p3', x: 0, y: 10 },
      {
        kind: 'bspline',
        id: 's',
        degree: 3,
        poles: ['p0', 'p1', 'p2', 'p3'],
        knots: [0, 0, 0, 0, 1, 1, 1, 1],
      },
    ]);
    const { geometry, calls } = controlledGeometry();
    const { viewport } = await editing(XY, { sketch, geometry });

    calls[0]?.resolve([hit('s', 's', [5, 4], { ta: 0.3, tb: 0.7 })]);
    await settle();

    expect(crossings(viewport)).toEqual(warningPoints(XY, [[5, 4]]));
  });

  it('without crossings there is no overlay; a write that removes them removes it', async () => {
    const { session, viewport } = await editing(XY, { sketch: CROSSED });
    expect(crossings(viewport)).toBeDefined();

    await session.remove([eid('cd')]);
    await settle();

    expect(crossings(viewport)).toBeUndefined();
  });

  it('an error of the port removes the overlay', async () => {
    const { geometry, calls } = controlledGeometry();
    const { session, viewport } = await editing(XY, { sketch: CROSSED, geometry });
    calls[0]?.resolve([hit('ab', 'cd', [5, 0])]);
    await settle();
    expect(crossings(viewport)).toBeDefined();

    await session.remove([eid('fg')]);
    calls[1]?.reject(new Error('kernel down'));
    await settle();

    expect(crossings(viewport)).toBeUndefined();
  });

  it('closing the session removes the overlay', async () => {
    const { session, viewport } = await editing(XY, { sketch: CROSSED });
    expect(crossings(viewport)).toBeDefined();

    session.cancel();

    expect(crossings(viewport)).toBeUndefined();
  });

  it('an answer after closing draws nothing', async () => {
    const { geometry, calls } = controlledGeometry();
    const { session, viewport } = await editing(XY, { sketch: CROSSED, geometry });

    session.cancel();
    calls[0]?.resolve([hit('ab', 'cd', [5, 0])]);
    await settle();

    expect(crossings(viewport)).toBeUndefined();
  });
});

describe('SketchSession.rewrite (M33)', () => {
  /** SKETCH with a new point n and the added constraint x (vertical pq). */
  const NEXT = data(
    [...SKETCH.entities, { kind: 'point', id: 'n', x: 3, y: 3 }],
    [...SKETCH.constraints, { kind: 'vertical', id: 'x', line: 'pq' }],
  );
  const ADDED: ReadonlySet<SketchConstraintId> = new Set([cid('x')]);

  it('solves the new data and writes it in one setParams', async () => {
    const { session, solver, applied, doc } = await editing();
    const calls = solver.calls.length;

    expect(await session.rewrite(NEXT, ADDED)).toBe(true);

    expect(solver.calls.slice(calls)).toEqual([NEXT]);
    expect(applied.map((op) => op.type)).toEqual(['feature.setParams']);
    expect(docConstraints(doc)).toEqual(NEXT.constraints);
  });

  it('on a conflict solves again without the added constraints', async () => {
    const { session, solver, applied, doc } = await editing();
    const calls = solver.calls.length;
    solver.next({ status: 'conflict', conflicting: [cid('x')] });

    expect(await session.rewrite(NEXT, ADDED)).toBe(true);

    expect(solver.calls.slice(calls).map((c) => c.constraints.map((k) => k.id))).toEqual([
      ['d', 'h', 'x'],
      ['d', 'h'],
    ]);
    expect(applied).toHaveLength(1);
    expect(docConstraints(doc)).toEqual(SKETCH.constraints);
  });

  it('an added constraint the solver finds redundant is left out', async () => {
    const { session, solver, doc } = await editing();
    solver.next({ redundant: [cid('x')] });

    expect(await session.rewrite(NEXT, ADDED)).toBe(true);

    expect(docConstraints(doc)).toEqual(SKETCH.constraints);
  });

  it('a conflict without the added constraints too writes nothing and reports it', async () => {
    const { session, solver, applied } = await editing();
    solver.next({ status: 'conflict', conflicting: [cid('x')] });
    solver.next({ status: 'conflict', conflicting: [cid('d')] });

    expect(await session.rewrite(NEXT, ADDED)).toBe(false);

    expect(applied).toEqual([]);
    expect(session.state.get().message).toEqual({ key: 'sketch.conflict' });
  });

  it('a failed solve writes nothing and reports it', async () => {
    const { session, solver, applied } = await editing();
    solver.next({ status: 'failed' });

    expect(await session.rewrite(NEXT, ADDED)).toBe(false);

    expect(applied).toEqual([]);
    expect(session.state.get().message).toEqual({ key: 'sketch.solverFailed' });
  });

  it('opts.edit opens the dimension once written (M34)', async () => {
    const { session } = await editing();
    const withRadius = data(
      [...NEXT.entities],
      [...NEXT.constraints, { kind: 'radius', id: 'r', curve: 'k', value: 2 }],
    );

    expect(await session.rewrite(withRadius, ADDED, { edit: cid('r') })).toBe(true);

    expect(session.state.get().editingDimension).toBe('r');
  });

  it('opts.edit of a rewrite that is not written opens nothing (M34)', async () => {
    const { session, solver } = await editing();
    solver.next({ status: 'failed' });

    expect(await session.rewrite(NEXT, ADDED, { edit: cid('d') })).toBe(false);

    expect(session.state.get().editingDimension).toBeNull();
  });

  it('without opts.edit the dimension being edited stays as it was (M34)', async () => {
    const { session } = await editing();

    expect(await session.rewrite(NEXT, ADDED)).toBe(true);

    expect(session.state.get().editingDimension).toBeNull();
  });

  it('is busy until written', async () => {
    const { session } = await editing();

    const written = session.rewrite(NEXT, ADDED);
    expect(session.state.get().busy).toBe(true);
    await written;
    expect(session.state.get().busy).toBe(false);
  });
});

describe('SketchSession.setConstructionMode (M31)', () => {
  it('is off on opening', async () => {
    const { session } = await editing();
    expect(session.state.get().constructionMode).toBe(false);
  });

  it('switches the state only: no solver, no write, no redraw', async () => {
    const { session, solver, viewport, applied } = await editing();
    const calls = solver.calls.length;
    const drawing = viewport.sketchDrawings.get('sketch-edit');

    session.setConstructionMode(true);
    expect(session.state.get().constructionMode).toBe(true);
    session.setConstructionMode(false);
    await settle();

    expect(session.state.get().constructionMode).toBe(false);
    expect(solver.calls).toHaveLength(calls);
    expect(applied).toEqual([]);
    expect(viewport.sketchDrawings.get('sketch-edit')).toBe(drawing);
  });

  it('the same value publishes no new state', async () => {
    const { session } = await editing();
    session.setConstructionMode(true);
    const before = session.state.get();

    session.setConstructionMode(true);
    expect(session.state.get()).toBe(before);
  });

  it('throws on a closed session', async () => {
    const { session } = await editing();
    session.cancel();
    expect(() => {
      session.setConstructionMode(true);
    }).toThrow(/closed/);
  });
});

/** The line pq of SKETCH (without its constraints) with a linear pattern: 2 instances, 5 mm up. */
const PATTERNED = data([
  { kind: 'point', id: 'p', x: 0, y: 0 },
  { kind: 'point', id: 'q', x: 10, y: 0 },
  { kind: 'line', id: 'pq', p1: 'p', p2: 'q' },
  {
    kind: 'linearPattern',
    id: 'lp',
    sources: ['pq'],
    direction1: { angle: Math.PI / 2, count: 2, spacing: 5 },
  },
]);

describe('SketchSession pattern copies (M36)', () => {
  /** The copy of a point in the pattern copies of `entities`. */
  function copy(entities: SketchData['entities'], id: string): unknown {
    return patternCopies({ entities, constraints: [] }).find((e) => e.id === id);
  }

  it('the copies follow a dragged source point in the state and in the document', async () => {
    const { session, doc } = await editing(XY, { sketch: PATTERNED });
    expect(copy(session.state.get().entities, 'lp:1.q')).toMatchObject({ x: 10, y: 5 });

    session.drag(eid('q'), [8, 2]);
    await settle();
    expect(copy(session.state.get().entities, 'lp:1.q')).toMatchObject({ x: 8, y: 7 });
    // The pattern itself went through the solve unchanged.
    expect(session.state.get().entities.find((e) => e.id === 'lp')).toEqual(
      PATTERNED.entities.find((e) => e.id === 'lp'),
    );

    await session.endDrag();
    const params = doc.feature(fid('s1'))?.params as Record<string, unknown> | undefined; // a sketch feature
    const written = data((params?.entities as readonly unknown[] | undefined) ?? []);
    expect(copy(written.entities, 'lp:1.q')).toMatchObject({ x: 8, y: 7 });
  });
});

describe('SketchSession pattern dimensions (M36)', () => {
  /** PATTERNED with a circular pattern cp around o and a mirror m across ab. */
  const PATTERNS = data([
    ...PATTERNED.entities,
    { kind: 'point', id: 'o', x: 5, y: -10 },
    { kind: 'circularPattern', id: 'cp', sources: ['pq'], center: 'o', count: 4, angle: Math.PI },
    { kind: 'point', id: 'a', x: 0, y: 20 },
    { kind: 'point', id: 'b', x: 10, y: 20 },
    { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
    { kind: 'mirror', id: 'm', sources: ['pq'], axis: 'ab' },
  ]);

  /** The entity `id` of 's1' in the document. */
  function docEntity(doc: ReturnType<typeof anOpsSession>['doc'], id: string): unknown {
    const params = doc.feature(fid('s1'))?.params as Record<string, unknown> | undefined; // a sketch feature
    const entities = (params?.entities as readonly { readonly id: string }[] | undefined) ?? [];
    return entities.find((e) => e.id === id);
  }

  it('patternDimensions shows only the selected patterns, in selection order', async () => {
    const { session } = await editing(XY, { sketch: PATTERNS });
    expect(session.state.get().patternDimensions).toEqual([]);

    session.select(eid('pq'));
    session.select(eid('m'), { additive: true });
    expect(session.state.get().patternDimensions).toEqual([]);

    session.select(eid('cp'));
    session.select(eid('lp'), { additive: true });
    expect(session.state.get().patternDimensions.map((v) => `${v.pattern}/${v.param}`)).toEqual([
      'cp/count',
      'cp/angle',
      'lp/count1',
      'lp/spacing1',
      'lp/angle1',
      'lp/count2',
    ]);
  });

  it('setPatternParam writes the parameter in one setParams without the solver', async () => {
    const { session, solver, applied, doc } = await editing(XY, { sketch: PATTERNS });
    const calls = solver.calls.length;

    expect(session.setPatternParam(eid('lp'), 'count1', 4)).toBe(true);
    await settle();

    expect(applied.map((op) => op.type)).toEqual(['feature.setParams']);
    expect(solver.calls).toHaveLength(calls);
    expect(docEntity(doc, 'lp')).toEqual({
      kind: 'linearPattern',
      id: 'lp',
      sources: ['pq'],
      direction1: { angle: Math.PI / 2, count: 4, spacing: 5 },
    });
    session.select(eid('lp'));
    expect(session.state.get().patternDimensions[0]).toMatchObject({ param: 'count1', value: 4 });
  });

  it('each parameter of a linear and of a circular pattern', async () => {
    const { session, doc } = await editing(XY, { sketch: PATTERNS });

    expect(session.setPatternParam(eid('lp'), 'spacing1', 7.5)).toBe(true);
    expect(session.setPatternParam(eid('lp'), 'angle1', -1)).toBe(true);
    expect(session.setPatternParam(eid('cp'), 'count', 6)).toBe(true);
    expect(session.setPatternParam(eid('cp'), 'angle', -2 * Math.PI)).toBe(true);
    await settle();

    expect(docEntity(doc, 'lp')).toMatchObject({
      direction1: { angle: -1, count: 2, spacing: 7.5 },
    });
    expect(docEntity(doc, 'cp')).toMatchObject({ count: 6, angle: -2 * Math.PI });
  });

  it('count2 ≥ 2 adds the second direction across direction 1 at spacing 1; 1 removes it', async () => {
    const { session, doc } = await editing(XY, { sketch: PATTERNS });

    expect(session.setPatternParam(eid('lp'), 'count2', 3)).toBe(true);
    await settle();
    expect(docEntity(doc, 'lp')).toEqual({
      kind: 'linearPattern',
      id: 'lp',
      sources: ['pq'],
      direction1: { angle: Math.PI / 2, count: 2, spacing: 5 },
      direction2: { angle: Math.PI, count: 3, spacing: 5 },
    });

    expect(session.setPatternParam(eid('lp'), 'spacing2', 2)).toBe(true);
    expect(session.setPatternParam(eid('lp'), 'angle2', 3)).toBe(true);
    await settle();
    expect(docEntity(doc, 'lp')).toMatchObject({
      direction2: { angle: 3, count: 3, spacing: 2 },
    });

    expect(session.setPatternParam(eid('lp'), 'count2', 1)).toBe(true);
    await settle();
    expect(docEntity(doc, 'lp')).toEqual({
      kind: 'linearPattern',
      id: 'lp',
      sources: ['pq'],
      direction1: { angle: Math.PI / 2, count: 2, spacing: 5 },
    });
  });

  it('an invalid value, an unknown id, a mirror or a foreign param → false and nothing', async () => {
    const { session, applied } = await editing(XY, { sketch: PATTERNS });
    const before = session.state.get();
    const refused: readonly (readonly [
      string,
      Parameters<typeof session.setPatternParam>[1],
      number,
    ])[] = [
      ['lp', 'count1', 1],
      ['lp', 'count1', 101],
      ['lp', 'count1', 2.5],
      ['lp', 'count2', 0],
      ['lp', 'count2', 101],
      ['lp', 'spacing1', 0],
      ['lp', 'spacing1', -2],
      ['lp', 'spacing1', Infinity],
      ['lp', 'angle1', Number.NaN],
      // No second direction to change.
      ['lp', 'spacing2', 3],
      ['lp', 'angle2', 1],
      ['lp', 'count', 3],
      ['cp', 'count', 1],
      ['cp', 'angle', 0],
      ['cp', 'angle', 7],
      ['cp', 'count1', 3],
      ['m', 'count', 3],
      ['pq', 'count', 3],
      ['nope', 'count', 3],
    ];
    for (const [id, param, value] of refused) {
      expect(
        session.setPatternParam(eid(id), param, value),
        `${id} ${param} ${String(value)}`,
      ).toBe(false);
    }
    await settle();

    expect(applied).toEqual([]);
    expect(session.state.get()).toBe(before);
  });

  it('behind a pending solve the write waits its turn and survives it', async () => {
    const { session, solver, doc } = await editing(XY, { sketch: PATTERNS });
    solver.hold();
    void session.setDimension(cid('nope'), 1);
    void session.remove([eid('m')]);

    expect(session.setPatternParam(eid('lp'), 'count1', 5)).toBe(true);
    solver.release();
    await settle();

    expect(docEntity(doc, 'm')).toBeUndefined();
    expect(docEntity(doc, 'lp')).toMatchObject({ direction1: { count: 5 } });
  });
});

describe('SketchSession.setTextParams (M37)', () => {
  /** The text 't' ('ab', sans, 10 mm) on its baseline and the line pq of SKETCH. */
  const TEXT = data([...SKETCH.entities, ...textData().entities], SKETCH.constraints);
  const fake = createFakeTextOutliner();

  function docEntity(doc: ReturnType<typeof anOpsSession>['doc'], id: string): unknown {
    const params = doc.feature(fid('s1'))?.params as Record<string, unknown> | undefined; // a sketch feature
    const entities = (params?.entities as readonly { readonly id: string }[] | undefined) ?? [];
    return entities.find((e) => e.id === id);
  }

  it('writes the string with new contours in one setParams without the solver', async () => {
    const { session, solver, applied, doc } = await editing(XY, { sketch: TEXT });
    const calls = solver.calls.length;

    await expect(session.setTextParams(eid('t'), { text: 'xyz' })).resolves.toBe(true);
    await settle();

    expect(applied.map((op) => op.type)).toEqual(['feature.setParams']);
    expect(solver.calls).toHaveLength(calls);
    expect(docEntity(doc, 't')).toEqual({
      kind: 'text',
      id: 't',
      text: 'xyz',
      font: 'sans',
      height: 10,
      baseline: 't.bl',
      contours: await fake.outline({ text: 'xyz', font: 'sans', height: 10 }),
    });
  });

  it('changes the font and the height; the rest of the text stays', async () => {
    const construction = data([...textData({ construction: true }).entities]);
    const { session, doc } = await editing(XY, { sketch: construction });

    await expect(session.setTextParams(eid('t'), { font: 'mono', height: 4 })).resolves.toBe(true);

    expect(docEntity(doc, 't')).toEqual({
      kind: 'text',
      id: 't',
      text: 'ab',
      font: 'mono',
      height: 4,
      baseline: 't.bl',
      contours: await fake.outline({ text: 'ab', font: 'mono', height: 4 }),
      construction: true,
    });
  });

  it('asks the outliner with the merged values', async () => {
    const asked: unknown[] = [];
    const spy: TextOutliner = {
      outline(p) {
        asked.push(p);
        return fake.outline(p);
      },
      advance: (p) => fake.advance(p),
    };
    const { session } = await editing(XY, { sketch: TEXT, text: spy });

    await session.setTextParams(eid('t'), { height: 3 });

    expect(asked).toEqual([{ text: 'ab', font: 'sans', height: 3 }]);
  });

  it.each([
    ['an empty string', 't', { text: '' }],
    ['a string too long', 't', { text: 'x'.repeat(201) }],
    ['a line break', 't', { text: 'a\nb' }],
    ['an unknown font', 't', { font: 'comic' as unknown as 'sans' }],
    ['height zero', 't', { height: 0 }],
    ['height negative', 't', { height: -1 }],
    ['height NaN', 't', { height: Number.NaN }],
    ['height infinite', 't', { height: Infinity }],
    ['the id of a line', 'pq', { text: 'x' }],
    ['an unknown id', 'nope', { text: 'x' }],
  ])('%s → false and nothing written', async (_name, id, params) => {
    const { session, applied } = await editing(XY, { sketch: TEXT });
    const before = session.state.get();

    await expect(session.setTextParams(eid(id), params)).resolves.toBe(false);
    await settle();

    expect(applied).toEqual([]);
    expect(session.state.get()).toBe(before);
  });

  it('an outliner that fails → false and nothing written', async () => {
    const failing: TextOutliner = {
      outline: () => Promise.reject(new Error('no font')),
      advance: () => Promise.reject(new Error('no font')),
    };
    const { session, applied } = await editing(XY, { sketch: TEXT, text: failing });

    await expect(session.setTextParams(eid('t'), { text: 'x' })).resolves.toBe(false);
    await settle();

    expect(applied).toEqual([]);
  });

  it('behind a pending solve the write waits its turn and survives it', async () => {
    const { session, solver, doc } = await editing(XY, { sketch: TEXT });
    solver.hold();
    void session.remove([eid('k')]);

    const written = session.setTextParams(eid('t'), { text: 'q' });
    solver.release();
    await expect(written).resolves.toBe(true);
    await settle();

    expect(docEntity(doc, 'k')).toBeUndefined();
    expect(docEntity(doc, 't')).toMatchObject({ text: 'q' });
  });
});
