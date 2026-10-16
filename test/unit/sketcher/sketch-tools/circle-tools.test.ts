import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Vec2 } from '@/core';
import { ORIGIN_PLANE_IDS, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, parseSketchData } from '@/sketch';
import type { SketchConstraint, SketchConstraintId, SketchData, SketchEntity } from '@/sketch';
import { createFakeSolver } from '@/sketch/testing';
import {
  SELECT_TOOL,
  createFeatureEditor,
  createSelectionModel,
  createToolManager,
  createToolRegistry,
} from '@/interaction';
import type { KeyMods, ToolContext, ViewPointerEvent } from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import { createSketchEditor } from '@/sketcher/sketch-editor';
import type { SketchSession } from '@/sketcher/sketch-session';
import { createSketchTools } from '@/sketcher/sketch-tools';

// The circle tools of M27 (spec 12, "Oblouky a kružnice (M27)", "Nástroje"): sketch.circle2p,
// sketch.circle3p, sketch.circle2t and sketch.circle3t. An open new sketch on the plane XY with
// the tools of the sketcher, the FakeSolver and the FakeViewport (in its default top view px = the
// local XY of the plane, 1 px = 1 mm). The tools snap through the snapper, so the fake needs no
// pick.

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

const NO_MODS: KeyMods = { shift: false, alt: false, mod: false };

/** Valid sketch data from plain values (parse brands the ids). */
function data(entities: readonly unknown[], constraints: readonly unknown[] = []): SketchData {
  const parsed = parseSketchData(entities, constraints);
  if (!parsed.ok) throw new Error(`invalid test data ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

/** Lets the solver answers (microtasks) and the queue settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** An open new sketch with `sketch` written into it and the tool `toolId` active. */
async function drawing(toolId: string, sketch?: SketchData) {
  const schemas = createFeatureSchemaRegistry();
  schemas.register(SKETCH_SCHEMA);
  const ops = anOpsSession({ schemas });
  const editor = createFeatureEditor({
    doc: ops.doc,
    ops: ops.dispatcher,
    schemas,
    ids: createSequentialIdGenerator('f'),
    translate: (key) => key,
  });
  const viewport = new FakeViewport();
  const solver = createFakeSolver();
  const sketches = createSketchEditor({
    features: editor,
    solver,
    viewport,
    resolvePlane: () => ({ origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] }),
    planeOfSketch: () => undefined,
  });
  const registry = createToolRegistry();
  registry.register(SELECT_TOOL);
  for (const tool of createSketchTools({ sketches })) registry.register(tool);
  const ctx: Omit<ToolContext, 'finish'> = {
    viewport,
    selection: createSelectionModel({ regen: new FakeRegenStatus() }),
    doc: ops.doc,
    ids: createSequentialIdGenerator('t'),
    features: editor,
  };
  const manager = createToolManager({
    registry,
    ctx,
    viewportEvents: viewport.events,
    defaultToolId: SELECT_TOOL.id,
    mode: sketches.mode,
    defaultToolIds: { sketch: 'sketch.select' },
  });
  manager.activate('sketch');
  const session = sketches.current.get();
  if (session === null) throw new Error('no session');
  if (sketch !== undefined) await session.addGeometry(sketch);
  await settle();
  manager.activate(toolId);
  return { viewport, manager, session, solver, sketches };
}

function pointer(
  type: ViewPointerEvent['type'],
  [x, y]: Vec2,
  mods: Partial<KeyMods>,
): ViewPointerEvent {
  return { type, x, y, button: type === 'move' ? null : 'left', mods: { ...NO_MODS, ...mods } };
}

function move(viewport: FakeViewport, at: Vec2, mods: Partial<KeyMods> = {}): void {
  viewport.emitPointer(pointer('move', at, mods));
}

/** A click at the point (with the move before it) and the writes settled. */
async function click(viewport: FakeViewport, at: Vec2, mods: Partial<KeyMods> = {}): Promise<void> {
  move(viewport, at, mods);
  viewport.emitPointer(pointer('down', at, mods));
  viewport.emitPointer(pointer('up', at, mods));
  await settle();
}

/** Clicks the points in order, each settled. */
async function clicks(viewport: FakeViewport, points: readonly Vec2[]): Promise<void> {
  for (const at of points) await click(viewport, at);
}

function escape(viewport: FakeViewport): void {
  viewport.emitKey({ key: 'Escape', mods: NO_MODS, inTextField: false });
}

const entitiesOf = (s: SketchSession): readonly SketchEntity[] => s.state.get().entities;
const constraintsOf = (s: SketchSession): readonly SketchConstraint[] => s.state.get().constraints;

/** The circles of the session that were not in `before`. */
function newCircles(s: SketchSession, before: SketchData | undefined) {
  const old = new Set(before?.entities.map((e) => e.id) ?? []);
  return entitiesOf(s).filter(
    (e): e is Extract<SketchEntity, { kind: 'circle' }> => e.kind === 'circle' && !old.has(e.id),
  );
}

/** The coordinates of the point `id` of the session. */
function xyOf(s: SketchSession, id: string): Vec2 | undefined {
  const p = entitiesOf(s).find((e) => e.id === id);
  return p?.kind === 'point' ? [p.x, p.y] : undefined;
}

/** The number of points of the preview polyline (pairs of the overlay 'sketch-tool'). */
function previewPoints(viewport: FakeViewport): number {
  const [shape] = viewport.overlayShapes.get('sketch-tool') ?? [];
  return shape?.points.length ?? 0;
}

/** A lone point m (50, 50) and the circle k around (200, 200) of radius 10. */
const POINT_AND_CIRCLE = data([
  { kind: 'point', id: 'm', x: 50, y: 50 },
  { kind: 'point', id: 'c', x: 200, y: 200 },
  { kind: 'circle', id: 'k', center: 'c', radius: 10 },
]);

describe('the 2-point circle tool', () => {
  it('two ends of a diameter make a circle with a new centre and no constraints', async () => {
    const { viewport, session } = await drawing('sketch.circle2p');

    await clicks(viewport, [
      [10, 10],
      [30, 10],
    ]);

    const [center, circle] = entitiesOf(session);
    expect(center).toMatchObject({ kind: 'point', x: 20, y: 10 });
    expect(circle).toMatchObject({ kind: 'circle', center: center?.id, radius: 10 });
    expect(constraintsOf(session)).toEqual([]);
  });

  it('an end on an existing point puts it on the circle; a radius near the last circle is equal', async () => {
    const { viewport, session } = await drawing('sketch.circle2p', POINT_AND_CIRCLE);

    await clicks(viewport, [
      [51, 50],
      [70, 50],
    ]);

    const [circle] = newCircles(session, POINT_AND_CIRCLE);
    expect(circle?.radius).toBe(10);
    expect(xyOf(session, circle?.center ?? '')).toEqual([60, 50]);
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'pointOnCurve', point: 'm', curve: circle?.id }),
      expect.objectContaining({ kind: 'equal', a: circle?.id, b: 'k' }),
    ]);
  });

  it('pointOnCurve is required: a conflict drops equal and keeps it', async () => {
    const { viewport, session, solver } = await drawing('sketch.circle2p', POINT_AND_CIRCLE);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });

    await clicks(viewport, [
      [51, 50],
      [70, 50],
    ]);

    expect(constraintsOf(session).map((c) => c.kind)).toEqual(['pointOnCurve']);
  });

  it('a conflict even without the automatic constraints writes nothing and the tool stays', async () => {
    const { viewport, session, solver, manager } = await drawing(
      'sketch.circle2p',
      POINT_AND_CIRCLE,
    );
    for (let i = 0; i < 3; i++)
      solver.next({ status: 'conflict', entities: null, conflicting: [] });

    await clicks(viewport, [
      [51, 50],
      [70, 50],
    ]);

    expect(newCircles(session, POINT_AND_CIRCLE)).toEqual([]);
    expect(session.state.get().message).toEqual({ key: 'sketch.conflict' });
    expect(manager.active.get()).toBe('sketch.circle2p');
  });

  it('with Ctrl/Cmd the radius gets no equal, the point on the circle stays', async () => {
    const { viewport, session } = await drawing('sketch.circle2p', POINT_AND_CIRCLE);

    await click(viewport, [51, 50], { mod: true });
    await click(viewport, [70, 50], { mod: true });

    expect(constraintsOf(session).map((c) => c.kind)).toEqual(['pointOnCurve']);
  });

  it('a second end on the first makes nothing and the first end stays', async () => {
    const { viewport, session, manager } = await drawing('sketch.circle2p');

    await clicks(viewport, [
      [10, 10],
      [10, 10],
    ]);
    expect(entitiesOf(session)).toEqual([]);
    expect(manager.active.get()).toBe('sketch.circle2p');

    await clicks(viewport, [[10, 30]]);
    expect(newCircles(session, undefined)).toEqual([expect.objectContaining({ radius: 10 })]);
  });

  it('Escape forgets the first end, a second Escape returns to sketch.select', async () => {
    const { viewport, session, manager } = await drawing('sketch.circle2p');
    await clicks(viewport, [[10, 10]]);
    move(viewport, [30, 10]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.circle2p');
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);

    await clicks(viewport, [
      [50, 10],
      [70, 10],
    ]);
    expect(xyOf(session, newCircles(session, undefined)[0]?.center ?? '')).toEqual([60, 10]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.select');
  });

  it('previews the circle through both ends; a degenerate one is not drawn', async () => {
    const { viewport } = await drawing('sketch.circle2p');
    await clicks(viewport, [[10, 10]]);

    move(viewport, [30, 10]);
    expect(previewPoints(viewport)).toBe(128);
    const [shape] = viewport.overlayShapes.get('sketch-tool') ?? [];
    expect(shape?.points[0]).toEqual([30, 10, 0]);

    move(viewport, [10, 10]);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
  });

  it('previews pointOnCurve over an existing point and equal of the radius', async () => {
    const { viewport, session } = await drawing('sketch.circle2p', POINT_AND_CIRCLE);

    move(viewport, [51, 50]);
    expect(session.state.get().inference).toEqual({ anchor: [50, 50, 0], kinds: ['pointOnCurve'] });

    await clicks(viewport, [[51, 50]]);
    move(viewport, [70, 50]);
    expect(session.state.get().inference).toEqual({ anchor: [70, 50, 0], kinds: ['equal'] });
  });
});

/**
 * Lone points a (100, 50), b (120, 70) and c (100, 90) on the circle around (100, 70) of radius
 * 20, and the circle k of the same radius around (300, 300).
 */
const RIM_POINTS = data([
  { kind: 'point', id: 'a', x: 100, y: 50 },
  { kind: 'point', id: 'b', x: 120, y: 70 },
  { kind: 'point', id: 'c', x: 100, y: 90 },
  { kind: 'point', id: 'k0', x: 300, y: 300 },
  { kind: 'circle', id: 'k', center: 'k0', radius: 20 },
]);

describe('the 3-point circle tool', () => {
  it('three points on the rim make the circumscribed circle with a new centre', async () => {
    const { viewport, session } = await drawing('sketch.circle3p');

    await clicks(viewport, [
      [10, 10],
      [30, 10],
      [20, 20],
    ]);

    const [center, circle] = entitiesOf(session);
    expect(center).toMatchObject({ kind: 'point', x: 20, y: 10 });
    expect(circle).toMatchObject({ kind: 'circle', center: center?.id, radius: 10 });
    expect(constraintsOf(session)).toEqual([]);
  });

  it('three existing points get 3× pointOnCurve, required: a conflict drops only equal', async () => {
    const { viewport, session, solver } = await drawing('sketch.circle3p', RIM_POINTS);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });

    await clicks(viewport, [
      [101, 50],
      [120, 71],
      [99, 90],
    ]);

    const [circle] = newCircles(session, RIM_POINTS);
    expect(circle?.radius).toBeCloseTo(20, 9);
    const [cx, cy] = xyOf(session, circle?.center ?? '') ?? [NaN, NaN];
    expect(cx).toBeCloseTo(100, 9);
    expect(cy).toBeCloseTo(70, 9);
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'pointOnCurve', point: 'a', curve: circle?.id }),
      expect.objectContaining({ kind: 'pointOnCurve', point: 'b', curve: circle?.id }),
      expect.objectContaining({ kind: 'pointOnCurve', point: 'c', curve: circle?.id }),
    ]);
  });

  it('a radius near the last circle or arc gets equal (automatic)', async () => {
    const sketch = data([
      { kind: 'point', id: 'k0', x: 200, y: 200 },
      { kind: 'circle', id: 'k', center: 'k0', radius: 10 },
    ]);
    const { viewport, session } = await drawing('sketch.circle3p', sketch);

    await clicks(viewport, [
      [10, 10],
      [30, 10],
      [20, 20],
    ]);

    const [circle] = newCircles(session, sketch);
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'equal', a: circle?.id, b: 'k' }),
    ]);
  });

  it('a third point on the line of the first two makes nothing and the two stay', async () => {
    const { viewport, session, manager } = await drawing('sketch.circle3p');

    await clicks(viewport, [
      [10, 10],
      [30, 10],
      [50, 10],
    ]);
    expect(entitiesOf(session)).toEqual([]);
    expect(manager.active.get()).toBe('sketch.circle3p');

    await clicks(viewport, [[20, 20]]);
    expect(newCircles(session, undefined)).toEqual([expect.objectContaining({ radius: 10 })]);
  });

  it('a point on a picked one makes nothing', async () => {
    const { viewport, session } = await drawing('sketch.circle3p');

    await clicks(viewport, [
      [10, 10],
      [10, 10],
      [30, 10],
      [30, 10],
    ]);
    expect(entitiesOf(session)).toEqual([]);

    await clicks(viewport, [[20, 20]]);
    expect(newCircles(session, undefined)).toHaveLength(1);
  });

  it('Escape forgets the picked points, a second Escape returns to sketch.select', async () => {
    const { viewport, session, manager } = await drawing('sketch.circle3p');
    await clicks(viewport, [
      [10, 10],
      [30, 10],
    ]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.circle3p');
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);

    await clicks(viewport, [[20, 20]]);
    expect(entitiesOf(session)).toEqual([]); // the first of three new points

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.circle3p');
    escape(viewport);
    expect(manager.active.get()).toBe('sketch.select');
  });

  it('previews the chord after one point, the circle after two, nothing on a line', async () => {
    const { viewport } = await drawing('sketch.circle3p');
    await clicks(viewport, [[10, 10]]);

    move(viewport, [30, 10]);
    expect(viewport.overlayShapes.get('sketch-tool')?.[0]?.points).toEqual([
      [10, 10, 0],
      [30, 10, 0],
    ]);

    await clicks(viewport, [[30, 10]]);
    move(viewport, [20, 20]);
    expect(previewPoints(viewport)).toBe(128);

    move(viewport, [50, 10]);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
  });

  it('previews pointOnCurve over an existing point', async () => {
    const { viewport, session } = await drawing('sketch.circle3p', RIM_POINTS);
    await clicks(viewport, [
      [10, 10],
      [30, 10],
    ]);

    move(viewport, [100, 51]);

    expect(session.state.get().inference).toEqual({
      anchor: [100, 50, 0],
      kinds: ['pointOnCurve'],
    });
  });
});

/**
 * The parallel lines a (y = 20) and b (y = 80) from x = 10 to 110, the circle k around (300, 100)
 * of radius 10 and the line g (y = 95) across it from x = 240 to 360.
 */
const CURVES = data([
  { kind: 'point', id: 'a1', x: 10, y: 20 },
  { kind: 'point', id: 'a2', x: 110, y: 20 },
  { kind: 'line', id: 'a', p1: 'a1', p2: 'a2' },
  { kind: 'point', id: 'b1', x: 10, y: 80 },
  { kind: 'point', id: 'b2', x: 110, y: 80 },
  { kind: 'line', id: 'b', p1: 'b1', p2: 'b2' },
  { kind: 'point', id: 'k0', x: 300, y: 100 },
  { kind: 'circle', id: 'k', center: 'k0', radius: 10 },
  { kind: 'point', id: 'g1', x: 240, y: 95 },
  { kind: 'point', id: 'g2', x: 360, y: 95 },
  { kind: 'line', id: 'g', p1: 'g1', p2: 'g2' },
]);

const ON_A: Vec2 = [40, 21];
const ON_B: Vec2 = [40, 79];
const ON_K: Vec2 = [300, 111];
const ON_G: Vec2 = [270, 96];

const selectionOf = (s: SketchSession) => s.state.get().selection;
const tangentsOf = (s: SketchSession) =>
  constraintsOf(s).filter(
    (c): c is Extract<SketchConstraint, { kind: 'tangent' }> => c.kind === 'tangent',
  );

describe('the 2-tangent circle tool', () => {
  it('two curves and a position make a circle tangent to both (2× tangent)', async () => {
    const { viewport, session } = await drawing('sketch.circle2t', CURVES);

    await clicks(viewport, [ON_A, ON_B, [70, 50]]);

    const [circle] = newCircles(session, CURVES);
    expect(circle?.radius).toBeCloseTo(30, 6);
    const [cx, cy] = xyOf(session, circle?.center ?? '') ?? [NaN, NaN];
    expect(cx).toBeCloseTo(70, 6);
    expect(cy).toBeCloseTo(50, 6);
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'tangent', a: circle?.id, b: 'a' }),
      expect.objectContaining({ kind: 'tangent', a: circle?.id, b: 'b' }),
    ]);
  });

  it('a circle and a line: the position chooses the tangent circle near the cursor', async () => {
    const { viewport, session } = await drawing('sketch.circle2t', CURVES);

    // Inside k, above g: a circle inside k touching it and g.
    await clicks(viewport, [ON_K, ON_G, [300, 103]]);

    const [circle] = newCircles(session, CURVES);
    expect(circle?.radius).toBeCloseTo(7.5, 6);
    expect(xyOf(session, circle?.center ?? '')?.[1]).toBeCloseTo(102.5, 6);
    expect(tangentsOf(session).map((c) => c.b)).toEqual(['k', 'g']);
  });

  it('the picked curves are selected while the tool works, the write clears them', async () => {
    const { viewport, session } = await drawing('sketch.circle2t', CURVES);

    await clicks(viewport, [ON_A]);
    expect(selectionOf(session)).toEqual(['a']);
    await clicks(viewport, [ON_B]);
    expect(selectionOf(session)).toEqual(['a', 'b']);

    await clicks(viewport, [[70, 50]]);
    expect(selectionOf(session)).toEqual([]);
  });

  it('a click off a curve or on a picked curve does nothing', async () => {
    const { viewport, session } = await drawing('sketch.circle2t', CURVES);

    await clicks(viewport, [[60, 50], ON_A, [41, 21]]);

    expect(selectionOf(session)).toEqual(['a']);
    expect(newCircles(session, CURVES)).toEqual([]);
  });

  it('a click on an end point hits its curve: points are not snapped to', async () => {
    const { viewport, session } = await drawing('sketch.circle2t', CURVES);

    await clicks(viewport, [[10, 81]]);

    expect(selectionOf(session)).toEqual(['b']);
  });

  it('a midpoint of a line hits the line', async () => {
    const { viewport, session } = await drawing('sketch.circle2t', CURVES);

    await clicks(viewport, [[60, 21]]);

    expect(selectionOf(session)).toEqual(['a']);
  });

  it('curves are picked with Ctrl/Cmd too; the tangents stay', async () => {
    const { viewport, session } = await drawing('sketch.circle2t', CURVES);

    for (const at of [ON_A, ON_B, [70, 50] satisfies Vec2])
      await click(viewport, at, { mod: true });

    expect(tangentsOf(session)).toHaveLength(2);
  });

  it('the tangents are required: a conflicting one is not left out, nothing is written', async () => {
    const { viewport, session, solver, manager } = await drawing('sketch.circle2t', CURVES);
    // The ids of the tool: t1 the centre, t2 the circle, t3 and t4 the tangents (a test id is
    // trusted). An automatic tangent would be left out and the circle written with one.
    const tangent = 't3' as SketchConstraintId;
    solver.next({ status: 'conflict', entities: null, conflicting: [tangent] });

    await clicks(viewport, [ON_A, ON_B, [70, 50]]);

    expect(newCircles(session, CURVES)).toEqual([]);
    expect(session.state.get().message).toEqual({ key: 'sketch.conflict' });
    expect(manager.active.get()).toBe('sketch.circle2t');
  });

  it('without a tangent circle near the cursor nothing is drawn nor written', async () => {
    const { viewport, session } = await drawing('sketch.circle2t', CURVES);
    await clicks(viewport, [ON_K, ON_G]);

    move(viewport, [300, 60]);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
    await clicks(viewport, [[300, 60]]);

    expect(newCircles(session, CURVES)).toEqual([]);
    expect(selectionOf(session)).toEqual(['k', 'g']);
  });

  it('Escape forgets the picked curves, a second Escape returns to sketch.select', async () => {
    const { viewport, session, manager } = await drawing('sketch.circle2t', CURVES);
    await clicks(viewport, [ON_A, ON_B]);
    move(viewport, [70, 50]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.circle2t');
    expect(selectionOf(session)).toEqual([]);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.select');
  });

  it('deactivating the tool clears the picked curves', async () => {
    const { viewport, session, manager } = await drawing('sketch.circle2t', CURVES);
    await clicks(viewport, [ON_A]);

    manager.activate('sketch.line');

    expect(selectionOf(session)).toEqual([]);
  });

  it('previews tangent over a curve and the circle at the cursor after two curves', async () => {
    const { viewport, session } = await drawing('sketch.circle2t', CURVES);

    move(viewport, ON_A);
    expect(session.state.get().inference).toEqual({ anchor: [40, 20, 0], kinds: ['tangent'] });
    move(viewport, [60, 50]);
    expect(session.state.get().inference).toBeNull();

    await clicks(viewport, [ON_A, ON_B]);
    move(viewport, [70, 50]);
    expect(previewPoints(viewport)).toBe(128);
    expect(viewport.overlayShapes.get('sketch-tool')?.[0]?.points[0]?.[0]).toBeCloseTo(100, 6);
    expect(session.state.get().inference).toBeNull();
  });
});

describe('the 3-tangent circle tool', () => {
  /** The right triangle (20, 20), (120, 20), (20, 120): sides p (y = 20), q (x = 20), r (x + y = 140). */
  const TRIANGLE = data([
    { kind: 'point', id: 'A', x: 20, y: 20 },
    { kind: 'point', id: 'B', x: 120, y: 20 },
    { kind: 'point', id: 'C', x: 20, y: 120 },
    { kind: 'line', id: 'p', p1: 'A', p2: 'B' },
    { kind: 'line', id: 'q', p1: 'A', p2: 'C' },
    { kind: 'line', id: 'r', p1: 'B', p2: 'C' },
  ]);
  const ON_P: Vec2 = [50, 21];
  const ON_Q: Vec2 = [21, 50];
  const ON_R: Vec2 = [80, 61];
  /** The inscribed circle: r = (100 + 100 − 100√2) / 2. */
  const INRADIUS = 100 - 50 * Math.SQRT2;

  it('three sides of a triangle with clicks around its inside make the inscribed circle', async () => {
    const { viewport, session } = await drawing('sketch.circle3t', TRIANGLE);

    await clicks(viewport, [ON_P, ON_Q, ON_R]);

    const [circle] = newCircles(session, TRIANGLE);
    expect(circle?.radius).toBeCloseTo(INRADIUS, 6);
    const [cx, cy] = xyOf(session, circle?.center ?? '') ?? [NaN, NaN];
    expect(cx).toBeCloseTo(20 + INRADIUS, 6);
    expect(cy).toBeCloseTo(20 + INRADIUS, 6);
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'tangent', a: circle?.id, b: 'p' }),
      expect.objectContaining({ kind: 'tangent', a: circle?.id, b: 'q' }),
      expect.objectContaining({ kind: 'tangent', a: circle?.id, b: 'r' }),
    ]);
    expect(selectionOf(session)).toEqual([]);
  });

  it('three parallel lines make nothing and the two picked stay', async () => {
    const sketch = data([
      ...TRIANGLE.entities,
      { kind: 'point', id: 'D', x: 20, y: 60 },
      { kind: 'point', id: 'E', x: 50, y: 60 },
      { kind: 'line', id: 's', p1: 'D', p2: 'E' },
      { kind: 'point', id: 'F', x: 20, y: 100 },
      { kind: 'point', id: 'G', x: 50, y: 100 },
      { kind: 'line', id: 't', p1: 'F', p2: 'G' },
    ]);
    const { viewport, session, manager } = await drawing('sketch.circle3t', sketch);

    await clicks(viewport, [ON_P, [40, 61], [40, 101]]);

    expect(newCircles(session, sketch)).toEqual([]);
    expect(selectionOf(session)).toEqual(['p', 's']);
    expect(manager.active.get()).toBe('sketch.circle3t');
  });

  it('Escape forgets the picked curves', async () => {
    const { viewport, session, manager } = await drawing('sketch.circle3t', TRIANGLE);
    await clicks(viewport, [ON_P, ON_Q]);

    escape(viewport);
    await clicks(viewport, [ON_R]);

    expect(selectionOf(session)).toEqual(['r']);
    expect(manager.active.get()).toBe('sketch.circle3t');
  });

  it('previews the circle and tangent over the third curve', async () => {
    const { viewport, session } = await drawing('sketch.circle3t', TRIANGLE);
    await clicks(viewport, [ON_P, ON_Q]);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);

    move(viewport, ON_R);

    expect(previewPoints(viewport)).toBe(128);
    expect(session.state.get().inference?.kinds).toEqual(['tangent']);
  });
});
