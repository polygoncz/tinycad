import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Vec2 } from '@/core';
import { ORIGIN_PLANE_IDS, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, parseSketchData } from '@/sketch';
import type { SketchData } from '@/sketch';
import { createFakeSketchGeometry, createFakeSolver } from '@/sketch/testing';
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

// The dimension tool (spec 12, "Kóty (M28)", "Nástroj Kóta"). In the default top view of
// FakeViewport px = the local XY of the plane XY.

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

/**
 * The line pq (10,10)–(40,50) of length 50, the vertical line r (60,10)–(60,60), the circle k
 * around c (100,100) of radius 20 and a lone point m (100,20).
 */
const SKETCH = data([
  { kind: 'point', id: 'p', x: 10, y: 10 },
  { kind: 'point', id: 'q', x: 40, y: 50 },
  { kind: 'line', id: 'pq', p1: 'p', p2: 'q' },
  { kind: 'point', id: 'r1', x: 60, y: 10 },
  { kind: 'point', id: 'r2', x: 60, y: 60 },
  { kind: 'line', id: 'r', p1: 'r1', p2: 'r2' },
  { kind: 'point', id: 'c', x: 100, y: 100 },
  { kind: 'circle', id: 'k', center: 'c', radius: 20 },
  { kind: 'point', id: 'm', x: 100, y: 20 },
]);

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

/** An open new sketch with `sketch` (SKETCH by default), the dimension tool active. */
async function dimensioning(sketch: SketchData = SKETCH) {
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
    geometry: createFakeSketchGeometry(),
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
  manager.activate('sketch.dimension');
  return { viewport, manager, session };
}

/** Lets the solver answers (microtasks) and the queue settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function pointer(type: ViewPointerEvent['type'], x: number, y: number): ViewPointerEvent {
  return { type, x, y, button: type === 'move' ? null : 'left', mods: NO_MODS };
}

function move(viewport: FakeViewport, [x, y]: Vec2): void {
  viewport.emitPointer(pointer('move', x, y));
}

/** A click at the point (with the move before it) and the writes settled. */
async function click(viewport: FakeViewport, at: Vec2): Promise<void> {
  move(viewport, at);
  viewport.emitPointer(pointer('down', at[0], at[1]));
  viewport.emitPointer(pointer('up', at[0], at[1]));
  await settle();
}

function escape(viewport: FakeViewport): void {
  viewport.emitKey({ key: 'Escape', mods: NO_MODS, inTextField: false });
}

const previewOf = (s: SketchSession) => s.state.get().dimensions.find((d) => d.preview === true);
const constraintsOf = (s: SketchSession) => s.state.get().constraints;

/** A point on pq, one on r and one on k. */
const ON_PQ: Vec2 = [25, 30];
const ON_R: Vec2 = [60, 40];
const ON_K: Vec2 = [120, 100];

describe('the dimension tool: a line', () => {
  it('a click on a line hangs the dimension on the cursor: a preview, nothing written', async () => {
    const { viewport, session } = await dimensioning();
    await click(viewport, ON_PQ);

    expect(previewOf(session)).toMatchObject({
      id: '__preview',
      preview: true,
      n: 0,
      selected: false,
    });
    expect(constraintsOf(session)).toEqual([]);
  });

  it('the kind follows the cursor: in the band aligned, above horizontal, beside vertical', async () => {
    const { viewport, session } = await dimensioning();
    await click(viewport, ON_PQ);

    move(viewport, [5, 40]);
    expect(previewOf(session)).toMatchObject({ kind: 'distance', value: 50 });
    move(viewport, [25, 200]);
    expect(previewOf(session)).toMatchObject({ kind: 'hDistance', value: 30 });
    move(viewport, [200, 30]);
    expect(previewOf(session)).toMatchObject({ kind: 'vDistance', value: 40 });
  });

  it('a click writes the dimension with its kind and placement, and edits it', async () => {
    const { viewport, session } = await dimensioning();
    await click(viewport, ON_PQ);
    await click(viewport, [5, 40]);

    // M = (25, 30), u = (0.6, 0.8), n = (−0.8, 0.6); cursor − M = (−20, 10).
    const [dimension] = constraintsOf(session);
    expect(dimension).toMatchObject({ kind: 'distance', a: 'p', b: 'q', value: 50 });
    expect(dimension).toHaveProperty('placement.kind', 'linear');
    expect(dimension).toHaveProperty('placement.offset', expect.closeTo(22, 9));
    expect(dimension).toHaveProperty('placement.along', expect.closeTo(-4, 9));
    expect(session.state.get().editingDimension).toBe(dimension?.id);
    expect(previewOf(session)).toBeUndefined();
  });

  it('after the write the tool starts again: a move shows nothing', async () => {
    const { viewport, session } = await dimensioning();
    await click(viewport, ON_PQ);
    await click(viewport, [25, 200]);
    move(viewport, [200, 30]);

    expect(constraintsOf(session).map((c) => c.kind)).toEqual(['hDistance']);
    expect(previewOf(session)).toBeUndefined();
  });

  it('a click on another line changes the target to the angle in the quadrant of the cursor', async () => {
    const { viewport, session } = await dimensioning();
    await click(viewport, ON_PQ);
    await click(viewport, ON_R);
    expect(constraintsOf(session)).toEqual([]);

    // The vertex is (60, 76.67); d_pq = (30, 40), d_r = (0, 50).
    move(viewport, [80, 120]);
    expect(previewOf(session)?.kind).toBe('angle');
    expect(previewOf(session)?.value).toBeCloseTo(Math.acos(0.8), 9);
    await click(viewport, [40, 120]);

    const [angle] = constraintsOf(session);
    expect(angle).toMatchObject({
      kind: 'angle',
      a: 'pq',
      b: 'r',
      reverseA: true,
    });
    expect(angle).toHaveProperty('value', expect.closeTo(Math.PI - Math.acos(0.8), 9));
    expect(angle).not.toHaveProperty('reverseB');
    expect(angle).toHaveProperty('placement.kind', 'angular');
  });

  it('a click on a point off the line changes the target to the distance from the line', async () => {
    const { viewport, session } = await dimensioning();
    await click(viewport, ON_PQ);
    await click(viewport, [100, 20]);
    expect(constraintsOf(session)).toEqual([]);
    expect(previewOf(session)?.kind).toBe('pointLineDistance');

    await click(viewport, [150, 0]);
    // m = (100, 20) from the line through (10, 10) with direction (0.6, 0.8): |(90, 10) × u|.
    const [dimension] = constraintsOf(session);
    expect(constraintsOf(session)).toHaveLength(1);
    expect(dimension).toMatchObject({ kind: 'pointLineDistance', point: 'm', line: 'pq' });
    expect(dimension).toHaveProperty('value', expect.closeTo(66, 9));
  });

  it('a click on an end of the line places the dimension', async () => {
    const { viewport, session } = await dimensioning();
    await click(viewport, ON_PQ);
    await click(viewport, [10, 10]);

    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'distance', a: 'p', b: 'q', value: 50 }),
    ]);
  });

  it('after another target any click places it, also on a line', async () => {
    const { viewport, session } = await dimensioning();
    await click(viewport, ON_PQ);
    await click(viewport, ON_R);
    await click(viewport, [80, 120]);

    expect(constraintsOf(session).map((c) => c.kind)).toEqual(['angle']);
  });
});

describe('the dimension tool: a circle', () => {
  it('inside the circle a radius, outside a diameter', async () => {
    const { viewport, session } = await dimensioning();
    await click(viewport, ON_K);

    move(viewport, [105, 100]);
    expect(previewOf(session)).toMatchObject({ kind: 'radius', value: 20 });
    move(viewport, [150, 100]);
    expect(previewOf(session)).toMatchObject({ kind: 'diameter', value: 40 });
    await click(viewport, [150, 100]);

    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({
        kind: 'diameter',
        curve: 'k',
        value: 40,
        placement: { kind: 'radial', angle: 0, distance: 50 },
      }),
    ]);
  });

  it('a click on a line places the dimension of the circle', async () => {
    const { viewport, session } = await dimensioning();
    await click(viewport, ON_K);
    await click(viewport, ON_PQ);

    expect(constraintsOf(session).map((c) => c.kind)).toEqual(['diameter']);
  });

  it('the cursor in the centre: no preview, and a click writes nothing', async () => {
    const { viewport, session } = await dimensioning();
    await click(viewport, ON_K);

    move(viewport, [100, 100]);
    expect(previewOf(session)).toBeUndefined();
    await click(viewport, [100, 100]);
    expect(constraintsOf(session)).toEqual([]);

    // Still hanging: away from the centre the preview is back.
    move(viewport, [110, 100]);
    expect(previewOf(session)?.kind).toBe('radius');
  });
});

describe('the dimension tool: a point first', () => {
  it('a point waits for the second entity without a preview', async () => {
    const { viewport, session } = await dimensioning();
    await click(viewport, [10, 10]);
    move(viewport, [30, 0]);

    expect(previewOf(session)).toBeUndefined();
    expect(constraintsOf(session)).toEqual([]);
  });

  it('a point and then another point: their distance hangs, a click writes it', async () => {
    const { viewport, session } = await dimensioning();
    await click(viewport, [10, 10]);
    await click(viewport, [100, 100]);
    expect(previewOf(session)).toBeDefined();
    await click(viewport, [60, 0]);

    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'distance', a: 'p', b: 'c', value: Math.hypot(90, 90) }),
    ]);
  });

  it('a point and then a line: the distance from the line', async () => {
    const { viewport, session } = await dimensioning();
    await click(viewport, [100, 20]);
    await click(viewport, ON_PQ);
    await click(viewport, [150, 0]);

    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'pointLineDistance', point: 'm', line: 'pq' }),
    ]);
  });

  it('an end of the line and then the line: the line on its own (like before M28)', async () => {
    const { viewport, session } = await dimensioning();
    await click(viewport, [10, 10]);
    await click(viewport, ON_PQ);
    expect(previewOf(session)?.kind).toBeDefined();
    await click(viewport, [25, 200]);

    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'hDistance', a: 'p', b: 'q' }),
    ]);
  });

  it('a click into empty space forgets the point', async () => {
    const { viewport, session } = await dimensioning();
    await click(viewport, [10, 10]);
    await click(viewport, [200, 0]);
    await click(viewport, [100, 100]);

    expect(previewOf(session)).toBeUndefined();
    expect(constraintsOf(session)).toEqual([]);
  });
});

/** SKETCH with the horizontal xline x through x1 (0,150) and x2 (10,150) (M31). */
const WITH_XLINE = data([
  ...SKETCH.entities,
  { kind: 'point', id: 'x1', x: 0, y: 150 },
  { kind: 'point', id: 'x2', x: 10, y: 150 },
  { kind: 'xline', id: 'x', p1: 'x1', p2: 'x2', construction: true },
]);

/** A point on the xline far from p1p2. */
const ON_X: Vec2 = [300, 150];

describe('the dimension tool: an xline (M31)', () => {
  it('an xline on its own has no length: no preview, it waits for another entity', async () => {
    const { viewport, session } = await dimensioning(WITH_XLINE);
    await click(viewport, ON_X);
    move(viewport, [300, 200]);
    expect(previewOf(session)).toBeUndefined();
    await click(viewport, [300, 200]);

    expect(constraintsOf(session)).toEqual([]);
  });

  it('the xline and then a point: the distance of the point from the xline', async () => {
    const { viewport, session } = await dimensioning(WITH_XLINE);
    await click(viewport, ON_X);
    await click(viewport, [100, 20]);
    expect(previewOf(session)?.kind).toBe('pointLineDistance');
    await click(viewport, [150, 0]);

    expect(constraintsOf(session)).toHaveLength(1);
    expect(constraintsOf(session)[0]).toMatchObject({
      kind: 'pointLineDistance',
      point: 'm',
      line: 'x',
    });
  });

  it('the xline and then a line: the angle', async () => {
    const { viewport, session } = await dimensioning(WITH_XLINE);
    await click(viewport, ON_X);
    await click(viewport, ON_PQ);
    expect(previewOf(session)?.kind).toBe('angle');
  });

  it('a point and then the xline: the distance of the point from the xline', async () => {
    const { viewport, session } = await dimensioning(WITH_XLINE);
    await click(viewport, [100, 20]);
    await click(viewport, ON_X);
    expect(previewOf(session)?.kind).toBe('pointLineDistance');
    await click(viewport, [150, 0]);

    const [dimension] = constraintsOf(session);
    expect(constraintsOf(session)).toHaveLength(1);
    expect(dimension).toMatchObject({ kind: 'pointLineDistance', point: 'm', line: 'x' });
    expect(dimension).toHaveProperty('value', expect.closeTo(130, 9));
  });

  it('a hanging dimension of a line and a click on the xline: the angle', async () => {
    const { viewport, session } = await dimensioning(WITH_XLINE);
    await click(viewport, ON_PQ);
    await click(viewport, ON_X);
    expect(constraintsOf(session)).toEqual([]);
    expect(previewOf(session)?.kind).toBe('angle');

    // The vertex is (115, 150); d_pq = (30, 40), d_x = (10, 0): the cursor between both rays.
    await click(viewport, [200, 200]);
    const [angle] = constraintsOf(session);
    expect(constraintsOf(session)).toHaveLength(1);
    expect(angle).toMatchObject({ kind: 'angle', a: 'pq', b: 'x' });
    expect(angle).toHaveProperty('value', expect.closeTo(Math.acos(0.6), 9));
  });
});

describe('the dimension tool: Esc', () => {
  it('drops the hanging dimension and stays in the tool', async () => {
    const { viewport, manager, session } = await dimensioning();
    await click(viewport, ON_PQ);
    escape(viewport);

    expect(previewOf(session)).toBeUndefined();
    expect(manager.active.get()).toBe('sketch.dimension');
    move(viewport, [5, 40]);
    await click(viewport, [5, 40]);
    expect(previewOf(session)).toBeUndefined();
    expect(constraintsOf(session)).toEqual([]);
  });

  it('forgets a waiting point', async () => {
    const { viewport, manager, session } = await dimensioning();
    await click(viewport, [10, 10]);
    escape(viewport);
    await click(viewport, [100, 100]);

    expect(manager.active.get()).toBe('sketch.dimension');
    expect(previewOf(session)).toBeUndefined();
  });

  it('without work in progress it goes on as before: back to the select tool', async () => {
    const { viewport, manager } = await dimensioning();
    escape(viewport);

    expect(manager.active.get()).toBe('sketch.select');
  });
});

describe('the dimension tool: deactivation', () => {
  it('another tool drops the preview', async () => {
    const { viewport, manager, session } = await dimensioning();
    await click(viewport, ON_PQ);
    expect(previewOf(session)).toBeDefined();

    manager.activate('sketch.select');

    expect(previewOf(session)).toBeUndefined();
  });
});
