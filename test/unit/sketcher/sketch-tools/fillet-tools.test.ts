import { describe, expect, it, vi } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Vec2 } from '@/core';
import { ORIGIN_PLANE_IDS, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamSchema } from '@/document';
import { aFakeOps } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, parseSketchData } from '@/sketch';
import type { SketchData, SketchEntity, SketchGeometry } from '@/sketch';
import {
  createFakeSketchGeometry,
  createFakeSolver,
  createFakeTextOutliner,
} from '@/sketch/testing';
import {
  SELECT_TOOL,
  createFeatureEditor,
  createSelectionModel,
  createToolManager,
  createToolRegistry,
} from '@/interaction';
import type {
  KeyMods,
  PickResult,
  SketchDrawing,
  ToolContext,
  ToolManager,
  ViewPointerEvent,
} from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import { createSketchEditor } from '@/sketcher/sketch-editor';
import type { SketchSession } from '@/sketcher/sketch-session';
import { createSketchTools } from '@/sketcher/sketch-tools';

// The fillet and chamfer tools (spec 12, "Zaoblení a sražení ve skice (M34)") over the
// FakeSketchGeometry. In the default top view of FakeViewport px = the local XY of the plane XY.

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

/** Pick radius in px of the fake: points first, then curves (like render). */
const PICK_RADIUS = 1;

function pickDrawings(viewport: FakeViewport, x: number, y: number): PickResult | null {
  for (const [sketch, drawing] of viewport.sketchDrawings) {
    const point = drawing.points.find((p) => Math.hypot(p.at[0] - x, p.at[1] - y) <= PICK_RADIUS);
    if (point !== undefined) return hit(sketch, point.id, x, y);
  }
  for (const [sketch, drawing] of viewport.sketchDrawings) {
    const curve = drawing.curves.find((c) => curveDistance(c, x, y) <= PICK_RADIUS);
    if (curve !== undefined) return hit(sketch, curve.id, x, y);
  }
  return null;
}

function hit(sketch: string, entity: string, x: number, y: number): PickResult {
  return { kind: 'sketchEntity', sketch, entity, point: [x, y, 0] };
}

function curveDistance(c: SketchDrawing['curves'][number], x: number, y: number): number {
  if (c.kind === 'arc') return Math.abs(Math.hypot(x - c.center[0], y - c.center[1]) - c.radius);
  if (c.kind === 'polyline') {
    return Math.min(
      ...c.points.slice(1).map((to, i) => segmentDistance(c.points[i] ?? to, to, x, y)),
    );
  }
  return segmentDistance(c.from, c.to, x, y);
}

function segmentDistance(from: Vec2, to: Vec2, x: number, y: number): number {
  const [ax, ay] = from;
  const [bx, by] = to;
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
  return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
}

/** An open new sketch with `sketch` and its hits settled, the tool `toolId` active. */
async function editing(
  sketch: SketchData,
  toolId: string,
  geometry: SketchGeometry = createFakeSketchGeometry(),
) {
  const schemas = createFeatureSchemaRegistry();
  schemas.register(SKETCH_SCHEMA);
  const ops = aFakeOps();
  const editor = createFeatureEditor({
    doc: ops.doc,
    ops,
    schemas,
    ids: createSequentialIdGenerator('f'),
    translate: (key) => key,
  });
  const viewport = new FakeViewport();
  viewport.setPick((x, y) => pickDrawings(viewport, x, y));
  const sketches = createSketchEditor({
    features: editor,
    solver: createFakeSolver(),
    geometry,
    text: createFakeTextOutliner(),
    viewport,
    resolvePlane: () => ({ origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] }),
    planeOfSketch: () => undefined,
  });
  const registry = createToolRegistry();
  registry.register(SELECT_TOOL);
  for (const tool of createSketchTools({ sketches })) registry.register(tool);
  const ctx: Omit<ToolContext, 'finish' | 'setHint'> = {
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
  await session.addGeometry(sketch);
  await settle();
  manager.activate(toolId);
  const rewrite = vi.spyOn(session, 'rewrite');
  return { viewport, session, rewrite, manager };
}

/** Lets the port and solver answers (microtasks) and the queue settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function pointer(type: ViewPointerEvent['type'], x: number, y: number): ViewPointerEvent {
  return { type, x, y, button: type === 'move' ? null : 'left', mods: NO_MODS };
}

async function move(viewport: FakeViewport, [x, y]: Vec2): Promise<void> {
  viewport.emitPointer(pointer('move', x, y));
  await settle();
}

/** A click at the point (with the move before it) and the writes settled. */
async function click(viewport: FakeViewport, at: Vec2): Promise<void> {
  await move(viewport, at);
  viewport.emitPointer(pointer('down', at[0], at[1]));
  viewport.emitPointer(pointer('up', at[0], at[1]));
  await settle();
}

const PREVIEW = 'sketch-tool';

/** The preview overlay as segments of plane points (z dropped), or undefined. */
function previewSegments(viewport: FakeViewport): readonly Vec2[] | undefined {
  const [shape] = viewport.overlayShapes.get(PREVIEW) ?? [];
  return shape?.points.map(([x, y]): Vec2 => [x, y]);
}

const entityOf = (s: SketchSession, id: string): SketchEntity | undefined =>
  s.state.get().entities.find((e) => e.id === id);

function xyOf(s: SketchSession, id: string): Vec2 {
  const p = entityOf(s, id);
  if (p?.kind !== 'point') throw new Error(`no point ${id}`);
  return [p.x, p.y];
}

function expectNear(actual: Vec2, expected: Vec2): void {
  expect(actual[0]).toBeCloseTo(expected[0], 6);
  expect(actual[1]).toBeCloseTo(expected[1], 6);
}

/** The rectangle a(0,0) b(100,0) c(100,40) d(0,40) with the width dimension w = 100. */
const RECT = data(
  [
    { kind: 'point', id: 'a', x: 0, y: 0 },
    { kind: 'point', id: 'b', x: 100, y: 0 },
    { kind: 'point', id: 'c', x: 100, y: 40 },
    { kind: 'point', id: 'd', x: 0, y: 40 },
    { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
    { kind: 'line', id: 'bc', p1: 'b', p2: 'c' },
    { kind: 'line', id: 'cd', p1: 'c', p2: 'd' },
    { kind: 'line', id: 'da', p1: 'd', p2: 'a' },
  ],
  [{ kind: 'distance', id: 'w', a: 'a', b: 'b', value: 100 }],
);

/**
 * The line l (0,0)–(50,0) and the arc r around (80,0) of radius 30 from (80,30) to (50,0): they
 * meet in the corner m = (50,0) at a right angle.
 */
const LINE_ARC = data([
  { kind: 'point', id: 'l1', x: 0, y: 0 },
  { kind: 'point', id: 'm', x: 50, y: 0 },
  { kind: 'line', id: 'l', p1: 'l1', p2: 'm' },
  { kind: 'point', id: 'o', x: 80, y: 0 },
  { kind: 'point', id: 's', x: 80, y: 30 },
  { kind: 'arc', id: 'r', center: 'o', start: 's', end: 'm' },
]);

/** A FakeSketchGeometry counting the calls of fillet. */
function countingGeometry(): SketchGeometry & { readonly fillets: number } {
  const fake = createFakeSketchGeometry();
  let fillets = 0;
  return {
    intersections: (curves) => fake.intersections(curves),
    segment: (curve, from, to) => fake.segment(curve, from, to),
    fillet: (a, b, radius, near) => {
      fillets += 1;
      return fake.fillet(a, b, radius, near);
    },
    offset: (chain, closed, distance) => fake.offset(chain, closed, distance),
    get fillets() {
      return fillets;
    },
  };
}

const constraintsOf = (s: SketchSession) => s.state.get().constraints;

/** The only entity of the kind not in `before`. */
function added<K extends SketchEntity['kind']>(
  s: SketchSession,
  before: SketchData,
  kind: K,
): Extract<SketchEntity, { kind: K }> {
  const old = new Set<string>(before.entities.map((e) => e.id));
  const found = s.state
    .get()
    .entities.filter(
      (e): e is Extract<SketchEntity, { kind: K }> => e.kind === kind && !old.has(e.id),
    );
  const [only] = found;
  if (found.length !== 1 || only === undefined) throw new Error(`not one new ${kind}`);
  return only;
}

describe('the fillet tool', () => {
  it('previews the arc over a corner', async () => {
    const { viewport } = await editing(RECT, 'sketch.fillet');
    await move(viewport, [100, 0]);

    const segments = previewSegments(viewport) ?? [];
    expect(segments.length).toBeGreaterThan(2);
    // The radius is ¼ of the shorter side: every point 10 from the centre (90, 10).
    for (const [x, y] of segments) expect(Math.hypot(x - 90, y - 10)).toBeCloseTo(10, 6);
  });

  it('a click on a corner rounds it in one rewrite: tangents, the radius dimension open', async () => {
    const { viewport, session, rewrite } = await editing(RECT, 'sketch.fillet');
    await click(viewport, [100, 0]);

    expect(rewrite).toHaveBeenCalledTimes(1);
    const arc = added(session, RECT, 'arc');
    expectNear(xyOf(session, arc.center), [90, 10]);
    const ab = entityOf(session, 'ab');
    const bc = entityOf(session, 'bc');
    if (ab?.kind !== 'line' || bc?.kind !== 'line') throw new Error('a side is gone');
    expectNear(xyOf(session, ab.p2), [90, 0]);
    expectNear(xyOf(session, bc.p1), [100, 10]);
    // The corner stays as the virtual sharp corner, the width dimension on it too.
    expectNear(xyOf(session, 'b'), [100, 0]);
    const constraints = constraintsOf(session);
    expect(constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'distance', id: 'w', a: 'a', b: 'b' }),
        expect.objectContaining({ kind: 'pointOnCurve', point: 'b', curve: 'ab' }),
        expect.objectContaining({ kind: 'pointOnCurve', point: 'b', curve: 'bc' }),
        expect.objectContaining({ kind: 'tangent', a: arc.id, b: 'ab' }),
        expect.objectContaining({ kind: 'tangent', a: arc.id, b: 'bc' }),
        expect.objectContaining({ kind: 'radius', curve: arc.id, value: 10 }),
      ]),
    );
    const radius = constraints.find((c) => c.kind === 'radius');
    expect(session.state.get().editingDimension).toBe(radius?.id);
    expect(viewport.overlayShapes.has(PREVIEW)).toBe(false);
  });

  it('two picked curves sharing an end keep the corner (it is sent as the corner)', async () => {
    const { viewport, session, rewrite } = await editing(RECT, 'sketch.fillet');
    await click(viewport, [50, 0]);
    expect(rewrite).not.toHaveBeenCalled();
    await click(viewport, [100, 20]);

    expect(rewrite).toHaveBeenCalledTimes(1);
    const arc = added(session, RECT, 'arc');
    expectNear(xyOf(session, arc.center), [90, 10]);
    expect(constraintsOf(session)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'pointOnCurve', point: 'b', curve: 'ab' }),
        expect.objectContaining({ kind: 'pointOnCurve', point: 'b', curve: 'bc' }),
        expect.objectContaining({ kind: 'distance', id: 'w' }),
      ]),
    );
  });

  it('two curves without a common end move to the points of contact', async () => {
    // p (0,0)–(40,0) and q (100,20)–(100,80): their carriers meet in (100,0).
    const apart = data([
      { kind: 'point', id: 'p1', x: 0, y: 0 },
      { kind: 'point', id: 'p2', x: 40, y: 0 },
      { kind: 'line', id: 'p', p1: 'p1', p2: 'p2' },
      { kind: 'point', id: 'q1', x: 100, y: 20 },
      { kind: 'point', id: 'q2', x: 100, y: 80 },
      { kind: 'line', id: 'q', p1: 'q1', p2: 'q2' },
    ]);
    const { viewport, session, rewrite } = await editing(apart, 'sketch.fillet');
    await click(viewport, [20, 0]);
    await click(viewport, [100, 50]);

    expect(rewrite).toHaveBeenCalledTimes(1);
    const p = entityOf(session, 'p');
    const q = entityOf(session, 'q');
    if (p?.kind !== 'line' || q?.kind !== 'line') throw new Error('a line is gone');
    expectNear(xyOf(session, p.p2), [90, 0]);
    expectNear(xyOf(session, q.p1), [100, 10]);
    expect(constraintsOf(session).some((c) => c.kind === 'pointOnCurve')).toBe(false);
  });

  it('without a fillet arc (parallel lines too far apart) nothing', async () => {
    const parallel = data([
      { kind: 'point', id: 'p1', x: 0, y: 0 },
      { kind: 'point', id: 'p2', x: 40, y: 0 },
      { kind: 'line', id: 'p', p1: 'p1', p2: 'p2' },
      { kind: 'point', id: 'q1', x: 0, y: 100 },
      { kind: 'point', id: 'q2', x: 40, y: 100 },
      { kind: 'line', id: 'q', p1: 'q1', p2: 'q2' },
    ]);
    const { viewport, rewrite } = await editing(parallel, 'sketch.fillet');
    await click(viewport, [20, 0]);
    await click(viewport, [20, 100]);

    expect(rewrite).not.toHaveBeenCalled();
  });

  it('the radius last used follows its dimension and outlives a switch of the tool', async () => {
    const { viewport, session, manager } = await editing(RECT, 'sketch.fillet');
    await click(viewport, [100, 0]);
    const radius = constraintsOf(session).find((c) => c.kind === 'radius');
    if (radius === undefined) throw new Error('no radius');
    expect(await session.setDimension(radius.id, 7)).toBe(true);

    manager.activate('sketch.select');
    manager.activate('sketch.fillet');
    await click(viewport, [0, 40]);

    const radii = constraintsOf(session).flatMap((c) => (c.kind === 'radius' ? [c.value] : []));
    expect(radii).toEqual([7, 7]);
  });

  it('a radius too large for the corner previews nothing and writes nothing', async () => {
    const { viewport, session, rewrite } = await editing(RECT, 'sketch.fillet');
    await click(viewport, [100, 0]);
    const radius = constraintsOf(session).find((c) => c.kind === 'radius');
    if (radius === undefined) throw new Error('no radius');
    await session.setDimension(radius.id, 45);
    rewrite.mockClear();

    await move(viewport, [0, 40]);
    expect(viewport.overlayShapes.has(PREVIEW)).toBe(false);
    await click(viewport, [0, 40]);

    expect(rewrite).not.toHaveBeenCalled();
  });

  it('an infinite line or a spline is not picked: the kernel is not asked', async () => {
    const geometry = countingGeometry();
    const sketch = data([
      { kind: 'point', id: 'p1', x: 0, y: 0 },
      { kind: 'point', id: 'p2', x: 40, y: 0 },
      { kind: 'line', id: 'p', p1: 'p1', p2: 'p2' },
      { kind: 'point', id: 'x1', x: 60, y: 20 },
      { kind: 'point', id: 'x2', x: 60, y: 40 },
      { kind: 'xline', id: 'x', p1: 'x1', p2: 'x2', construction: true },
      { kind: 'point', id: 'k1', x: 0, y: 80 },
      { kind: 'point', id: 'k2', x: 20, y: 90 },
      { kind: 'point', id: 'k3', x: 40, y: 80 },
      { kind: 'bspline', id: 'k', poles: ['k1', 'k2', 'k3'], degree: 2, knots: [0, 0, 0, 1, 1, 1] },
    ]);
    const { viewport, rewrite } = await editing(sketch, 'sketch.fillet', geometry);
    await click(viewport, [20, 0]);
    await click(viewport, [60, 50]);
    await click(viewport, [20, 0]);
    await click(viewport, [20, 85]);

    expect(geometry.fillets).toBe(0);
    expect(rewrite).not.toHaveBeenCalled();
  });

  it('the last request wins: an answer of an older one draws no preview', async () => {
    const fake = createFakeSketchGeometry();
    const answers: (() => void)[] = [];
    const geometry: SketchGeometry = {
      intersections: (curves) => fake.intersections(curves),
      segment: (curve, from, to) => fake.segment(curve, from, to),
      fillet: (a, b, radius, near) =>
        new Promise((resolve, reject) => {
          answers.push(() => {
            fake.fillet(a, b, radius, near).then(resolve, reject);
          });
        }),
      offset: (chain, closed, distance) => fake.offset(chain, closed, distance),
    };
    const { viewport } = await editing(RECT, 'sketch.fillet', geometry);
    await move(viewport, [100, 0]);
    await move(viewport, [0, 40]);
    const [older, newer] = answers;
    newer?.();
    await settle();
    older?.();
    await settle();

    expect(answers).toHaveLength(2);
    // The arc of the corner d (0,40): around (10, 30).
    const segments = previewSegments(viewport) ?? [];
    expect(segments.length).toBeGreaterThan(2);
    for (const [x, y] of segments) expect(Math.hypot(x - 10, y - 30)).toBeCloseTo(10, 6);
  });

  it('Escape forgets the first picked curve', async () => {
    const { viewport, rewrite } = await editing(RECT, 'sketch.fillet');
    await click(viewport, [50, 0]);
    viewport.emitKey({ key: 'Escape', mods: NO_MODS, inTextField: false });
    await click(viewport, [100, 20]);

    expect(rewrite).not.toHaveBeenCalled();
  });
});

describe('the chamfer tools', () => {
  it('two distances: a click on a corner cuts it, both distances dimensioned', async () => {
    const { viewport, session, rewrite } = await editing(RECT, 'sketch.chamfer');
    await move(viewport, [100, 0]);
    const preview = previewSegments(viewport) ?? [];
    expect(preview).toHaveLength(2);
    await click(viewport, [100, 0]);

    expect(rewrite).toHaveBeenCalledTimes(1);
    const line = added(session, RECT, 'line');
    expectNear(xyOf(session, line.p1), [90, 0]);
    expectNear(xyOf(session, line.p2), [100, 10]);
    const constraints = constraintsOf(session);
    expect(constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'distance', a: 'b', b: line.p1, value: 10 }),
        expect.objectContaining({ kind: 'distance', a: 'b', b: line.p2, value: 10 }),
        expect.objectContaining({ kind: 'pointOnCurve', point: 'b', curve: 'ab' }),
        expect.objectContaining({ kind: 'pointOnCurve', point: 'b', curve: 'bc' }),
        expect.objectContaining({ kind: 'distance', id: 'w' }),
      ]),
    );
    const first = constraints.find((c) => c.kind === 'distance' && c.b === line.p1);
    expect(session.state.get().editingDimension).toBe(first?.id);
  });

  it('distance and angle: the angle of 45° to the reference line', async () => {
    const { viewport, session, rewrite } = await editing(RECT, 'sketch.chamferAngle');
    await click(viewport, [100, 0]);

    expect(rewrite).toHaveBeenCalledTimes(1);
    const line = added(session, RECT, 'line');
    expectNear(xyOf(session, line.p1), [90, 0]);
    expectNear(xyOf(session, line.p2), [100, 10]);
    expect(constraintsOf(session)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'distance', a: 'b', b: line.p1, value: 10 }),
        expect.objectContaining({ kind: 'angle', a: line.id, b: 'ab', value: Math.PI / 4 }),
      ]),
    );
  });

  it('two picked curves sharing a corner are chamfered too', async () => {
    const { viewport, session, rewrite } = await editing(RECT, 'sketch.chamfer');
    await click(viewport, [50, 0]);
    await click(viewport, [100, 20]);

    expect(rewrite).toHaveBeenCalledTimes(1);
    const line = added(session, RECT, 'line');
    expectNear(xyOf(session, line.p1), [90, 0]);
  });

  it('two curves without a common corner are not chamfered', async () => {
    const apart = data([
      { kind: 'point', id: 'p1', x: 0, y: 0 },
      { kind: 'point', id: 'p2', x: 40, y: 0 },
      { kind: 'line', id: 'p', p1: 'p1', p2: 'p2' },
      { kind: 'point', id: 'q1', x: 100, y: 20 },
      { kind: 'point', id: 'q2', x: 100, y: 80 },
      { kind: 'line', id: 'q', p1: 'q1', p2: 'q2' },
    ]);
    const { viewport, rewrite } = await editing(apart, 'sketch.chamfer');
    await click(viewport, [20, 0]);
    await click(viewport, [100, 50]);

    expect(rewrite).not.toHaveBeenCalled();
  });

  it('two distances on an arc: the point at the chord from the corner', async () => {
    const { viewport, session, rewrite } = await editing(LINE_ARC, 'sketch.chamfer');
    // Nearer the arc than the line: the arc is a.
    await click(viewport, [50, 0.5]);

    expect(rewrite).toHaveBeenCalledTimes(1);
    const line = added(session, LINE_ARC, 'line');
    const [p, q] = [xyOf(session, line.p1), xyOf(session, line.p2)];
    // ¼ of the shorter curve (the arc, 15π ≈ 47.1) rounded: 12.
    expect(Math.hypot(p[0] - 50, p[1])).toBeCloseTo(12, 6);
    expect(Math.hypot(p[0] - 80, p[1])).toBeCloseTo(30, 6);
    expect(p[1]).toBeGreaterThan(0);
    expectNear(q, [38, 0]);
  });

  it('distance and angle with the cursor nearer an arc take the line as the reference', async () => {
    const { viewport, session, rewrite } = await editing(LINE_ARC, 'sketch.chamferAngle');
    await click(viewport, [50, 0.5]);

    expect(rewrite).toHaveBeenCalledTimes(1);
    const line = added(session, LINE_ARC, 'line');
    expectNear(xyOf(session, line.p1), [38, 0]);
    expectNear(xyOf(session, line.p2), [56, 18]);
    expect(constraintsOf(session)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'distance', a: 'm', b: line.p1, value: 12 }),
        expect.objectContaining({ kind: 'angle', a: line.id, b: 'l', value: Math.PI / 4 }),
      ]),
    );
  });

  it('distance and angle between two arcs: nothing', async () => {
    const arcs = data([
      { kind: 'point', id: 'o1', x: 0, y: 0 },
      { kind: 'point', id: 's1', x: 30, y: 0 },
      { kind: 'point', id: 'm', x: 0, y: 30 },
      { kind: 'arc', id: 'r1', center: 'o1', start: 's1', end: 'm' },
      { kind: 'point', id: 'o2', x: 0, y: 60 },
      { kind: 'point', id: 'e2', x: 30, y: 60 },
      { kind: 'arc', id: 'r2', center: 'o2', start: 'm', end: 'e2' },
    ]);
    const { viewport, rewrite } = await editing(arcs, 'sketch.chamferAngle');
    await click(viewport, [0, 30]);

    expect(viewport.overlayShapes.has(PREVIEW)).toBe(false);
    expect(rewrite).not.toHaveBeenCalled();
  });
});

describe('the fillet and chamfer tools: the hint HUD (M35)', () => {
  const hintOf = (manager: ToolManager): string | null => manager.hint.get()?.key ?? null;

  it.each([
    ['sketch.fillet', 'fillet'],
    ['sketch.chamfer', 'chamfer'],
    ['sketch.chamferAngle', 'chamferAngle'],
  ])('%s: the first curve, then the second one; Escape goes back', async (tool, name) => {
    const { viewport, manager } = await editing(RECT, tool);
    expect(hintOf(manager)).toBe(`hint.${name}.first`);

    await click(viewport, [50, 0]);
    expect(hintOf(manager)).toBe(`hint.${name}.second`);

    viewport.emitKey({ key: 'Escape', mods: NO_MODS, inTextField: false });
    expect(hintOf(manager)).toBe(`hint.${name}.first`);

    manager.activate('sketch.select');
    expect(manager.hint.get()).toBeNull();
  });

  it('after the second curve the hint of the first one is back', async () => {
    const { viewport, manager, rewrite } = await editing(RECT, 'sketch.fillet');
    await click(viewport, [50, 0]);
    await click(viewport, [100, 20]);

    expect(rewrite).toHaveBeenCalledTimes(1);
    expect(hintOf(manager)).toBe('hint.fillet.first');
  });

  it('a click on a corner keeps the hint of the first curve', async () => {
    const { viewport, manager } = await editing(RECT, 'sketch.chamfer');
    await click(viewport, [100, 0]);

    expect(hintOf(manager)).toBe('hint.chamfer.first');
  });

  it('a click off any curve forgets the first one: the hint of the first curve', async () => {
    const { viewport, manager } = await editing(RECT, 'sketch.fillet');
    await click(viewport, [50, 0]);
    await click(viewport, [50, 20]);

    expect(hintOf(manager)).toBe('hint.fillet.first');
  });
});
