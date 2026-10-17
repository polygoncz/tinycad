import { describe, expect, it, vi } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Vec2 } from '@/core';
import { ORIGIN_PLANE_IDS, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, parseSketchData } from '@/sketch';
import type { OffsetCurve2, SketchData, SketchEntity, SketchGeometry } from '@/sketch';
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

// The offset tool (spec 12, "Offset (M35)", "Nástroj") over the FakeSketchGeometry (offsets of
// chains of lines). In the default top view of FakeViewport px = the local XY of the plane XY.

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

/** An open new sketch with `sketch` and its hits settled, the offset tool active. */
async function editing(sketch: SketchData, geometry: SketchGeometry = createFakeSketchGeometry()) {
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
    viewport,
    resolvePlane: () => ({ origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] }),
    planeOfSketch: () => undefined,
    text: createFakeTextOutliner(),
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
  manager.activate('sketch.offset');
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

async function keys(viewport: FakeViewport, ...pressed: readonly string[]): Promise<void> {
  for (const key of pressed) viewport.emitKey({ key, mods: NO_MODS, inTextField: false });
  await settle();
}

const PREVIEW = 'sketch-tool';

/** The preview overlay as segments of plane points (z dropped), or undefined. */
function previewSegments(viewport: FakeViewport): readonly Vec2[] | undefined {
  const [shape] = viewport.overlayShapes.get(PREVIEW) ?? [];
  return shape?.points.map(([x, y]): Vec2 => [x, y]);
}

/** The corners of the preview segments, rounded to 1e-6 and sorted. */
function corners(points: readonly Vec2[]): readonly string[] {
  const keyOf = ([x, y]: Vec2) =>
    `${(Math.round(x * 1e6) / 1e6).toString()},${(Math.round(y * 1e6) / 1e6).toString()}`;
  return [...new Set(points.map(keyOf))].sort();
}

const entityOf = (s: SketchSession, id: string): SketchEntity | undefined =>
  s.state.get().entities.find((e) => e.id === id);

function xyOf(s: SketchSession, id: string): Vec2 {
  const p = entityOf(s, id);
  if (p?.kind !== 'point') throw new Error(`no point ${id}`);
  return [p.x, p.y];
}

/** The ends of the new lines (not in `before`), as sorted keys like corners(). */
function newLineEnds(s: SketchSession, before: SketchData): readonly string[] {
  const old = new Set<string>(before.entities.map((e) => e.id));
  const ends = s.state
    .get()
    .entities.flatMap((e) => (e.kind === 'line' && !old.has(e.id) ? [e.p1, e.p2] : []));
  return corners(ends.map((id) => xyOf(s, id)));
}

const constraintsOf = (s: SketchSession) => s.state.get().constraints;

/** The rectangle a(0,0) b(100,0) c(100,40) d(0,40): the first distance is 10 % of 40 = 4. */
const RECT = data([
  { kind: 'point', id: 'a', x: 0, y: 0 },
  { kind: 'point', id: 'b', x: 100, y: 0 },
  { kind: 'point', id: 'c', x: 100, y: 40 },
  { kind: 'point', id: 'd', x: 0, y: 40 },
  { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
  { kind: 'line', id: 'bc', p1: 'b', p2: 'c' },
  { kind: 'line', id: 'cd', p1: 'c', p2: 'd' },
  { kind: 'line', id: 'da', p1: 'd', p2: 'a' },
]);

const OUT = corners([
  [-4, -4],
  [104, -4],
  [104, 44],
  [-4, 44],
]);
const IN = corners([
  [4, 4],
  [96, 4],
  [96, 36],
  [4, 36],
]);

/** The open L p(0,0) → q(50,0) → r(50,30): the first distance is 10 % of 30 = 3. */
const L = data([
  { kind: 'point', id: 'p', x: 0, y: 0 },
  { kind: 'point', id: 'q', x: 50, y: 0 },
  { kind: 'point', id: 'r', x: 50, y: 30 },
  { kind: 'line', id: 'pq', p1: 'p', p2: 'q' },
  { kind: 'line', id: 'qr', p1: 'q', p2: 'r' },
]);

/** A FakeSketchGeometry whose offsets wait until released, in the order of the calls. */
function deferredGeometry(): SketchGeometry & { release(i: number): void } {
  const fake = createFakeSketchGeometry();
  const pending: (() => void)[] = [];
  return {
    intersections: (curves) => fake.intersections(curves),
    segment: (curve, from, to) => fake.segment(curve, from, to),
    fillet: (a, b, radius, near) => fake.fillet(a, b, radius, near),
    offset: (chain, closed, distance) =>
      new Promise<readonly OffsetCurve2[]>((resolve, reject) => {
        pending.push(() => {
          fake.offset(chain, closed, distance).then(resolve, reject);
        });
      }),
    release(i) {
      pending[i]?.();
    },
  };
}

describe('the offset tool', () => {
  it('previews the offset of the whole chain outwards when the cursor is outside', async () => {
    const { viewport, rewrite } = await editing(RECT);
    await move(viewport, [50, -0.5]);

    expect(corners(previewSegments(viewport) ?? [])).toEqual(OUT);
    expect(rewrite).not.toHaveBeenCalled();
  });

  it('a click writes the offset in one rewrite: shared corners, the offset constraint open', async () => {
    const { viewport, session, rewrite } = await editing(RECT);
    await click(viewport, [50, -0.5]);

    expect(rewrite).toHaveBeenCalledTimes(1);
    expect(newLineEnds(session, RECT)).toEqual(OUT);
    // Four new points shared by the four copies.
    expect(session.state.get().entities.filter((e) => e.kind === 'point')).toHaveLength(8);
    const offsets = constraintsOf(session).filter((c) => c.kind === 'offset');
    expect(offsets).toHaveLength(1);
    const [offset] = offsets;
    if (offset?.kind !== 'offset') throw new Error('no offset');
    expect(offset.value).toBe(4);
    expect(offset.pairs.map((p) => p.source).sort()).toEqual(['ab', 'bc', 'cd', 'da']);
    expect(rewrite.mock.calls[0]?.[2]).toEqual({ edit: offset.id });
    expect(session.state.get().editingDimension).toBe(offset.id);
    expect(viewport.overlayShapes.has(PREVIEW)).toBe(false);
  });

  it('the cursor inside the closed chain offsets inwards', async () => {
    const { viewport, session } = await editing(RECT);
    await move(viewport, [100 - 0.5, 20]);
    expect(corners(previewSegments(viewport) ?? [])).toEqual(IN);

    await click(viewport, [100 - 0.5, 20]);
    expect(newLineEnds(session, RECT)).toEqual(IN);
  });

  it('an open chain: the side of the nearest curve along the walk', async () => {
    const { viewport } = await editing(L);
    // Left of p → q (+y): a negative distance (> 0 is right of the walk).
    await move(viewport, [25, 0.5]);
    expect(corners(previewSegments(viewport) ?? [])).toEqual(
      corners([
        [0, 3],
        [47, 3],
        [47, 30],
      ]),
    );
    // Right of q → r (+x).
    await move(viewport, [50.5, 20]);
    expect(corners(previewSegments(viewport) ?? [])).toEqual(
      corners([
        [0, -3],
        [53, -3],
        [53, 30],
      ]),
    );
  });

  it('the distance of the session is used next (the current value of its dimension)', async () => {
    const { viewport, session } = await editing(L);
    await click(viewport, [25, 0.5]);
    const offset = constraintsOf(session).find((c) => c.kind === 'offset');
    if (offset?.kind !== 'offset') throw new Error('no offset');
    expect(offset.value).toBe(3);
    await session.setDimension(offset.id, 5);
    await settle();

    // The fake solver moves nothing: the original offset right (below) by the edited 5.
    await move(viewport, [25, -0.5]);
    expect(corners(previewSegments(viewport) ?? [])).toEqual(
      corners([
        [0, -5],
        [55, -5],
        [55, 30],
      ]),
    );
  });

  it('the typed and locked distance (numeric input) is used by Enter', async () => {
    const { viewport, session, rewrite } = await editing(RECT);
    await move(viewport, [50, -0.5]);
    expect(session.state.get().numericInput?.fields).toEqual([
      expect.objectContaining({ id: 'distance', kind: 'length', text: '4.00', typed: false }),
    ]);
    await keys(viewport, '7');
    expect(corners(previewSegments(viewport) ?? [])).toEqual(
      corners([
        [-7, -7],
        [107, -7],
        [107, 47],
        [-7, 47],
      ]),
    );
    await keys(viewport, 'Enter');

    expect(rewrite).toHaveBeenCalledTimes(1);
    const offset = constraintsOf(session).find((c) => c.kind === 'offset');
    expect(offset?.kind === 'offset' ? offset.value : null).toBe(7);
  });

  it('the last request wins: a late answer of an older one draws no preview', async () => {
    const geometry = deferredGeometry();
    const { viewport } = await editing(RECT, geometry);
    await move(viewport, [50, -0.5]);
    await move(viewport, [50, 0.5]);

    geometry.release(1);
    await settle();
    expect(corners(previewSegments(viewport) ?? [])).toEqual(IN);
    geometry.release(0);
    await settle();
    expect(corners(previewSegments(viewport) ?? [])).toEqual(IN);
  });

  it('an answer for a place the cursor left draws nothing', async () => {
    const geometry = deferredGeometry();
    const { viewport } = await editing(RECT, geometry);
    await move(viewport, [50, -0.5]);
    await move(viewport, [50, 20]);

    geometry.release(0);
    await settle();
    expect(previewSegments(viewport)).toBeUndefined();
  });

  it('a click while the kernel answers: nothing written when the data changed meanwhile', async () => {
    const geometry = deferredGeometry();
    const { viewport, session, rewrite } = await editing(RECT, geometry);
    await click(viewport, [50, -0.5]);
    await session.addGeometry(
      data([
        { kind: 'point', id: 'x1', x: 200, y: 0 },
        { kind: 'point', id: 'x2', x: 300, y: 0 },
        { kind: 'line', id: 'x', p1: 'x1', p2: 'x2' },
      ]),
    );
    await settle();

    geometry.release(0);
    await settle();
    expect(rewrite).not.toHaveBeenCalled();
  });

  it('an infinite line and a copy of a pattern offer nothing', async () => {
    const sketch = data([
      { kind: 'point', id: 'x1', x: 0, y: 50 },
      { kind: 'point', id: 'x2', x: 10, y: 50 },
      { kind: 'xline', id: 'x', p1: 'x1', p2: 'x2', construction: true },
      { kind: 'point', id: 'l1', x: 10, y: 10 },
      { kind: 'point', id: 'l2', x: 30, y: 10 },
      { kind: 'line', id: 'l', p1: 'l1', p2: 'l2' },
      { kind: 'point', id: 'a1', x: 0, y: -100 },
      { kind: 'point', id: 'a2', x: 0, y: -50 },
      { kind: 'line', id: 'axis', p1: 'a1', p2: 'a2', construction: true },
      { kind: 'mirror', id: 'm', sources: ['l'], axis: 'axis' },
    ]);
    const { viewport, rewrite } = await editing(sketch);
    await move(viewport, [60, 50.5]);
    expect(previewSegments(viewport)).toBeUndefined();
    await click(viewport, [60, 50.5]);
    // The mirrored copy of l lies at x −30…−10.
    await move(viewport, [-20, 10.5]);
    expect(previewSegments(viewport)).toBeUndefined();
    await click(viewport, [-20, 10.5]);

    expect(rewrite).not.toHaveBeenCalled();
  });
});
