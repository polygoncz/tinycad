import { describe, expect, it, vi } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Vec2 } from '@/core';
import { ORIGIN_PLANE_IDS, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, curve2, parseSketchData, pointAt, pointsById } from '@/sketch';
import type { Curve2, CurveHit, SketchData, SketchEntity, SketchGeometry } from '@/sketch';
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
  ViewPointerEvent,
} from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import { createSketchEditor } from '@/sketcher/sketch-editor';
import type { SketchSession } from '@/sketcher/sketch-session';
import { createSketchTools } from '@/sketcher/sketch-tools';

// The trim, extend and split tools (spec 12, "Trim, extend, split (M33)") over the
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

/** The horizontal line h (0,50)–(100,50). */
const H = [
  { kind: 'point', id: 'h1', x: 0, y: 50 },
  { kind: 'point', id: 'h2', x: 100, y: 50 },
  { kind: 'line', id: 'h', p1: 'h1', p2: 'h2' },
];
/** The vertical line v (50,0)–(50,100), crossing h in (50,50). */
const V = [
  { kind: 'point', id: 'v1', x: 50, y: 0 },
  { kind: 'point', id: 'v2', x: 50, y: 100 },
  { kind: 'line', id: 'v', p1: 'v1', p2: 'v2' },
];
const CROSS = data([...H, ...V]);

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
  const ops = anOpsSession({ schemas });
  const editor = createFeatureEditor({
    doc: ops.doc,
    ops: ops.dispatcher,
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
  return { viewport, session, rewrite };
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

/** A geometry that never answers: hits() stays null. */
const SILENT: SketchGeometry = {
  intersections: () => new Promise<never>(() => undefined),
  segment: () => new Promise<never>(() => undefined),
};

describe('the trim tool', () => {
  it('previews the piece under the cursor between the cuts', async () => {
    const { viewport } = await editing(CROSS, 'sketch.trim');
    await move(viewport, [20, 50]);

    const segments = previewSegments(viewport);
    expect(segments).toHaveLength(2);
    expectNear(segments?.[0] ?? [NaN, NaN], [0, 50]);
    expectNear(segments?.[1] ?? [NaN, NaN], [50, 50]);
  });

  it('a click removes the piece in one rewrite: the line keeps its id from the cut on', async () => {
    const { viewport, session, rewrite } = await editing(CROSS, 'sketch.trim');
    await click(viewport, [20, 50]);

    expect(rewrite).toHaveBeenCalledTimes(1);
    const h = entityOf(session, 'h');
    if (h?.kind !== 'line') throw new Error('h is gone');
    expectNear(xyOf(session, h.p1), [50, 50]);
    expect(h.p2).toBe('h2');
    expect(entityOf(session, 'h1')).toBeUndefined();
    expect(session.state.get().constraints).toEqual([
      expect.objectContaining({ kind: 'pointOnCurve', point: h.p1, curve: 'v' }),
    ]);
    expect(viewport.overlayShapes.has(PREVIEW)).toBe(false);
  });

  it('a click on a curve without cuts removes it', async () => {
    const { viewport, session, rewrite } = await editing(data(H), 'sketch.trim');
    await click(viewport, [20, 50]);

    expect(rewrite).toHaveBeenCalledTimes(1);
    expect(session.state.get().entities).toEqual([]);
  });

  it('without the hits of the current data offers nothing and writes nothing', async () => {
    const { viewport, session, rewrite } = await editing(CROSS, 'sketch.trim', SILENT);
    await click(viewport, [20, 50]);

    expect(session.hits()).toBeNull();
    expect(viewport.overlayShapes.has(PREVIEW)).toBe(false);
    expect(rewrite).not.toHaveBeenCalled();
    expect(session.state.get().entities).toHaveLength(6);
  });

  it('off a curve shows nothing and writes nothing', async () => {
    const { viewport, rewrite } = await editing(CROSS, 'sketch.trim');
    await click(viewport, [20, 70]);

    expect(viewport.overlayShapes.has(PREVIEW)).toBe(false);
    expect(rewrite).not.toHaveBeenCalled();
  });

  it('a spline asks segment for the kept piece and becomes it', async () => {
    const geometry = splineGeometry();
    const { viewport, session, rewrite } = await editing(SPLINE, 'sketch.trim', geometry);
    await click(viewport, pointAt(splineCurve(), 0.8));

    expect(geometry.segments).toEqual([[0, 0.5]]);
    expect(rewrite).toHaveBeenCalledTimes(1);
    const z = entityOf(session, 'z');
    if (z?.kind !== 'bspline') throw new Error('z is not a bspline');
    expect(z.poles[0]).toBe('a');
    expect(z.poles).toHaveLength(4);
    expectNear(xyOf(session, z.poles[3] ?? ''), [40, 30]);
  });
});

describe('the extend tool', () => {
  /** The line a (0,0)–(40,0) and the circle k around (100,0) of radius 20. */
  const LINE_CIRCLE = data([
    { kind: 'point', id: 'a1', x: 0, y: 0 },
    { kind: 'point', id: 'a2', x: 40, y: 0 },
    { kind: 'line', id: 'a', p1: 'a1', p2: 'a2' },
    { kind: 'point', id: 'c', x: 100, y: 0 },
    { kind: 'circle', id: 'k', center: 'c', radius: 20 },
  ]);

  it('previews the extension of the nearer end to the nearest intersection', async () => {
    const { viewport } = await editing(LINE_CIRCLE, 'sketch.extend');
    await move(viewport, [35, 0]);

    const segments = previewSegments(viewport);
    expect(segments).toHaveLength(2);
    expectNear(segments?.[0] ?? [NaN, NaN], [40, 0]);
    expectNear(segments?.[1] ?? [NaN, NaN], [80, 0]);
  });

  it('a click moves the end onto the curve with pointOnCurve, in one rewrite', async () => {
    const { viewport, session, rewrite } = await editing(LINE_CIRCLE, 'sketch.extend');
    await click(viewport, [35, 0]);

    expect(rewrite).toHaveBeenCalledTimes(1);
    const a = entityOf(session, 'a');
    if (a?.kind !== 'line') throw new Error('a is gone');
    expect(a.p1).toBe('a1');
    expectNear(xyOf(session, a.p2), [80, 0]);
    expect(entityOf(session, 'a2')).toBeUndefined();
    expect(session.state.get().constraints).toEqual([
      expect.objectContaining({ kind: 'pointOnCurve', point: a.p2, curve: 'k' }),
    ]);
  });

  it('the start end goes the other way: nothing there, nothing written', async () => {
    const { viewport, rewrite } = await editing(LINE_CIRCLE, 'sketch.extend');
    await click(viewport, [5, 0]);

    expect(viewport.overlayShapes.has(PREVIEW)).toBe(false);
    expect(rewrite).not.toHaveBeenCalled();
  });

  it('without an intersection nothing', async () => {
    const away = data([
      ...LINE_CIRCLE.entities.filter((e) => e.id !== 'c'),
      { kind: 'point', id: 'c', x: 100, y: 50 },
    ]);
    const { viewport, rewrite } = await editing(away, 'sketch.extend');
    await click(viewport, [35, 0]);

    expect(viewport.overlayShapes.has(PREVIEW)).toBe(false);
    expect(rewrite).not.toHaveBeenCalled();
  });

  it('an arc extends along its circle beyond its end', async () => {
    // The arc around (0,0) of radius 10 from 0° to 90°; the line x = −5 meets its circle at 120°.
    const sketch = data([
      { kind: 'point', id: 'o', x: 0, y: 0 },
      { kind: 'point', id: 's', x: 10, y: 0 },
      { kind: 'point', id: 'e', x: 0, y: 10 },
      { kind: 'arc', id: 'r', center: 'o', start: 's', end: 'e' },
      { kind: 'point', id: 'l1', x: -5, y: -20 },
      { kind: 'point', id: 'l2', x: -5, y: 20 },
      { kind: 'line', id: 'l', p1: 'l1', p2: 'l2' },
    ]);
    const { viewport, session, rewrite } = await editing(sketch, 'sketch.extend');
    const angle = (80 * Math.PI) / 180;
    await click(viewport, [10 * Math.cos(angle), 10 * Math.sin(angle)]);

    expect(rewrite).toHaveBeenCalledTimes(1);
    const r = entityOf(session, 'r');
    if (r?.kind !== 'arc') throw new Error('r is gone');
    expect(r.start).toBe('s');
    expectNear(xyOf(session, r.end), [-5, 10 * Math.sin((120 * Math.PI) / 180)]);
  });

  it('a circle is not extended', async () => {
    const { viewport, rewrite } = await editing(LINE_CIRCLE, 'sketch.extend');
    await click(viewport, [100, 20]);

    expect(viewport.overlayShapes.has(PREVIEW)).toBe(false);
    expect(rewrite).not.toHaveBeenCalled();
  });

  it('the last request wins: an answer of an older one is dropped', async () => {
    const answers: ((hits: readonly CurveHit[]) => void)[] = [];
    const fake = createFakeSketchGeometry();
    const geometry: SketchGeometry = {
      intersections: (curves) =>
        // The session's own request (without __extend) is answered at once.
        curves.some((c) => c.id === '__extend')
          ? new Promise((resolve) => answers.push(resolve))
          : fake.intersections(curves),
      segment: (curve, from, to) => fake.segment(curve, from, to),
    };
    const { viewport, session, rewrite } = await editing(LINE_CIRCLE, 'sketch.extend', geometry);
    await move(viewport, [35, 0]);
    await move(viewport, [5, 0]);
    const [older, newer] = answers;
    // The older request (end) answers after the newer one (start): its preview never shows.
    newer?.([]);
    await settle();
    older?.([{ a: '__extend', b: 'k', point: [80, 0], ta: 0.0004, tb: Math.PI }]);
    await settle();

    expect(answers).toHaveLength(2);
    expect(viewport.overlayShapes.has(PREVIEW)).toBe(false);
    expect(rewrite).not.toHaveBeenCalled();
    expect(session.state.get().entities).toHaveLength(5);
  });
});

describe('the split tool', () => {
  it('previews the point and splits a line there: two lines, parallel, one rewrite', async () => {
    const { viewport, session, rewrite } = await editing(data(H), 'sketch.split');
    await move(viewport, [30, 50]);
    const [shape] = viewport.overlayShapes.get(PREVIEW) ?? [];
    expect(shape).toEqual({ kind: 'points', points: [[30, 50, 0]], style: 'preview' });

    await click(viewport, [30, 50]);
    expect(rewrite).toHaveBeenCalledTimes(1);
    const lines = session.state.get().entities.filter((e) => e.kind === 'line');
    expect(lines).toHaveLength(2);
    const [first, second] = lines;
    if (first?.kind !== 'line' || second?.kind !== 'line') throw new Error('no lines');
    expect(first).toMatchObject({ id: 'h', p1: 'h1' });
    expect(second).toMatchObject({ p1: first.p2, p2: 'h2' });
    expectNear(xyOf(session, first.p2), [30, 50]);
    expect(session.state.get().constraints).toEqual([
      expect.objectContaining({ kind: 'parallel', a: 'h', b: second.id }),
    ]);
  });

  it('snaps to a cut within the click tolerance: the new point gets pointOnCurve', async () => {
    const { viewport, session, rewrite } = await editing(CROSS, 'sketch.split');
    await click(viewport, [52, 50]);

    expect(rewrite).toHaveBeenCalledTimes(1);
    const h = entityOf(session, 'h');
    if (h?.kind !== 'line') throw new Error('h is gone');
    expectNear(xyOf(session, h.p2), [50, 50]);
    expect(session.state.get().constraints).toContainEqual(
      expect.objectContaining({ kind: 'pointOnCurve', point: h.p2, curve: 'v' }),
    );
  });

  it('beyond the click tolerance splits in the point of the cursor', async () => {
    const { viewport, session } = await editing(CROSS, 'sketch.split');
    await click(viewport, [56, 50]);

    const h = entityOf(session, 'h');
    if (h?.kind !== 'line') throw new Error('h is gone');
    expectNear(xyOf(session, h.p2), [56, 50]);
  });

  it('at an end of the curve nothing', async () => {
    const { viewport, rewrite } = await editing(data(H), 'sketch.split');
    // Past the end point (its pick radius) but still on the line within the pick of the fake.
    await click(viewport, [100.5, 50.8]);

    expect(viewport.overlayShapes.has(PREVIEW)).toBe(false);
    expect(rewrite).not.toHaveBeenCalled();
  });

  it('a spline asks segment for both pieces', async () => {
    const geometry = splineGeometry();
    const { viewport, session, rewrite } = await editing(SPLINE, 'sketch.split', geometry);
    await click(viewport, pointAt(splineCurve(), 0.25));

    expect(geometry.segments).toHaveLength(2);
    expect(geometry.segments[0]?.[0]).toBe(0);
    expect(geometry.segments[0]?.[1]).toBeCloseTo(0.25, 4);
    expect(geometry.segments[1]?.[1]).toBe(1);
    expect(rewrite).toHaveBeenCalledTimes(1);
    expect(session.state.get().entities.filter((e) => e.kind === 'bspline')).toHaveLength(2);
  });
});

describe('the modify tools on derived curves (a text letter, a pattern copy)', () => {
  /**
   * The line s (0,10)–(40,10) mirrored across the vertical line a x = 60 (copy (80,10)–(120,10)),
   * and the text t 'I' on the baseline b (0,-20)–(30,-20): its letter a triangle
   * with the side (10,-20)–(10,0).
   */
  const DERIVED = data([
    { kind: 'point', id: 's1', x: 0, y: 10 },
    { kind: 'point', id: 's2', x: 40, y: 10 },
    { kind: 'line', id: 's', p1: 's1', p2: 's2' },
    { kind: 'point', id: 'a1', x: 60, y: 0 },
    { kind: 'point', id: 'a2', x: 60, y: 80 },
    { kind: 'line', id: 'a', p1: 'a1', p2: 'a2' },
    { kind: 'mirror', id: 'm', sources: ['s'], axis: 'a' },
    { kind: 'point', id: 'b1', x: 0, y: -20 },
    { kind: 'point', id: 'b2', x: 30, y: -20 },
    { kind: 'line', id: 'b', p1: 'b1', p2: 'b2' },
    {
      kind: 'text',
      id: 't',
      text: 'I',
      font: 'sans',
      height: 20,
      baseline: 'b',
      contours: [
        {
          char: 0,
          code: 73,
          segments: [
            [
              [10, 0],
              [10, 20],
            ],
            [
              [10, 20],
              [14, 0],
            ],
            [
              [14, 0],
              [10, 0],
            ],
          ],
        },
      ],
    },
  ]);
  const ON_COPY: Vec2 = [100, 10];
  const ON_LETTER: Vec2 = [10, -10];

  it.each([
    ['sketch.trim', 'copy', ON_COPY],
    ['sketch.trim', 'letter', ON_LETTER],
    ['sketch.extend', 'copy', ON_COPY],
    ['sketch.extend', 'letter', ON_LETTER],
    ['sketch.split', 'copy', ON_COPY],
    ['sketch.split', 'letter', ON_LETTER],
  ])('%s on a %s does nothing', async (tool, _target, at) => {
    const { viewport, session, rewrite } = await editing(DERIVED, tool);
    const before = session.state.get().entities;
    await click(viewport, at);

    expect(viewport.overlayShapes.has(PREVIEW)).toBe(false);
    expect(rewrite).not.toHaveBeenCalled();
    expect(session.state.get().entities).toBe(before);
  });
});

/**
 * A cubic Bézier spline z through the poles a b c d (one span), crossed by the vertical line x
 * at t = 0.5 in (40, 30).
 */
const SPLINE = data([
  { kind: 'point', id: 'a', x: 0, y: 0 },
  { kind: 'point', id: 'b', x: 20, y: 40 },
  { kind: 'point', id: 'c', x: 60, y: 40 },
  { kind: 'point', id: 'd', x: 80, y: 0 },
  {
    kind: 'bspline',
    id: 'z',
    degree: 3,
    poles: ['a', 'b', 'c', 'd'],
    knots: [0, 0, 0, 0, 1, 1, 1, 1],
  },
  { kind: 'point', id: 'x1', x: 40, y: -10 },
  { kind: 'point', id: 'x2', x: 40, y: 50 },
  { kind: 'line', id: 'x', p1: 'x1', p2: 'x2' },
]);

function splineCurve(): Curve2 {
  const z = SPLINE.entities.find((e) => e.id === 'z');
  if (z === undefined || z.kind !== 'bspline') throw new Error('no spline');
  return curve2(z, pointsById(SPLINE));
}

/**
 * A geometry for SPLINE (the fake does no splines): the one hit of x and z, pieces of the Bézier
 * by de Casteljau; it records the ranges segment was asked for.
 */
function splineGeometry(): SketchGeometry & { readonly segments: [number, number][] } {
  const segments: [number, number][] = [];
  return {
    segments,
    intersections: () => Promise.resolve([{ a: 'z', b: 'x', point: [40, 30], ta: 0.5, tb: 2 / 3 }]),
    segment: (curve, from, to) => {
      segments.push([from, to]);
      return Promise.resolve(bezierPiece(curve, from, to));
    },
  };
}

/** The piece [from, to] of a single-span Bézier by de Casteljau, knots kept [0, 1]. */
function bezierPiece(c: Curve2, from: number, to: number): Curve2 {
  if (c.kind !== 'bspline') throw new Error('not a spline');
  const split = (poles: readonly Vec2[], t: number): [Vec2[], Vec2[]] => {
    const left: Vec2[] = [];
    const right: Vec2[] = [];
    let row = [...poles];
    while (row.length > 0) {
      left.push(row[0] ?? [NaN, NaN]);
      right.unshift(row.at(-1) ?? [NaN, NaN]);
      row = row.slice(1).map((p, i): Vec2 => {
        const q = row[i] ?? p;
        return [q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t];
      });
    }
    return [left, right];
  };
  const [, tail] = split(c.poles, from);
  const [piece] = split(tail, from === 1 ? 0 : (to - from) / (1 - from));
  return { kind: 'bspline', degree: c.degree, poles: piece, knots: c.knots };
}
