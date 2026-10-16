import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Vec2 } from '@/core';
import { ORIGIN_PLANE_IDS, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, parseSketchData } from '@/sketch';
import type { SketchConstraint, SketchData, SketchEntity } from '@/sketch';
import { createFakeSketchGeometry, createFakeSolver } from '@/sketch/testing';
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

// The rectangle tools of M31 (spec 12, "Nové kreslicí nástroje (M31)", "Nástroje"):
// sketch.rectangleCenter and sketch.rectangle3p. An open new sketch on the plane XY with the
// tools of the sketcher, the FakeSolver and the FakeViewport (in its default top view px = the
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
    geometry: createFakeSketchGeometry(),
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

const kindsOf = (s: SketchSession): readonly string[] => constraintsOf(s).map((c) => c.kind);
const inferenceOf = (s: SketchSession) => s.state.get().inference;

/** The new entities of the session (not in `before`) of the kind. */
function added<K extends SketchEntity['kind']>(
  s: SketchSession,
  kind: K,
  before?: SketchData,
): readonly Extract<SketchEntity, { kind: K }>[] {
  const old = new Set(before?.entities.map((e) => e.id) ?? []);
  return entitiesOf(s).filter(
    (e): e is Extract<SketchEntity, { kind: K }> => e.kind === kind && !old.has(e.id),
  );
}

/** The coordinates of the point `id` of the session. */
function xyOf(s: SketchSession, id: string): Vec2 | undefined {
  const p = entitiesOf(s).find((e) => e.id === id);
  return p?.kind === 'point' ? [p.x, p.y] : undefined;
}

/** The number of points of the preview (pairs of the overlay 'sketch-tool'). */
function previewPoints(viewport: FakeViewport): number {
  const [shape] = viewport.overlayShapes.get('sketch-tool') ?? [];
  return shape?.points.length ?? 0;
}

/** A lone point m (50, 50). */
const LONE_POINT = data([{ kind: 'point', id: 'm', x: 50, y: 50 }]);

/** A horizontal line h at y = 25, its ends and midpoint far away. */
const LINE_AT_25 = data([
  { kind: 'point', id: 'h1', x: -200, y: 25 },
  { kind: 'point', id: 'h2', x: 300, y: 25 },
  { kind: 'line', id: 'h', p1: 'h1', p2: 'h2' },
]);

/** The ends of the new lines of the session as coordinates, in the order of the data. */
function linesAt(s: SketchSession, before?: SketchData) {
  return added(s, 'line', before).map((l) => ({
    from: xyOf(s, l.p1),
    to: xyOf(s, l.p2),
    construction: l.construction === true,
  }));
}

const RECTANGLE_CENTER_KINDS = ['horizontal', 'horizontal', 'vertical', 'vertical', 'midpoint'];
const RECTANGLE_3P_KINDS = ['perpendicular', 'parallel', 'parallel'];

describe('the center rectangle tool', () => {
  it('the centre and a corner make 4 lines, a construction diagonal, H/V and the midpoint', async () => {
    const { viewport, session } = await drawing('sketch.rectangleCenter');

    await clicks(viewport, [
      [20, 20],
      [30, 25],
    ]);

    const points = added(session, 'point');
    expect(points.map((p) => [p.x, p.y])).toEqual([
      [20, 20],
      [10, 15],
      [30, 15],
      [30, 25],
      [10, 25],
    ]);
    expect(linesAt(session)).toEqual([
      { from: [10, 15], to: [30, 15], construction: false },
      { from: [30, 15], to: [30, 25], construction: false },
      { from: [30, 25], to: [10, 25], construction: false },
      { from: [10, 25], to: [10, 15], construction: false },
      { from: [10, 15], to: [30, 25], construction: true },
    ]);
    const lines = added(session, 'line');
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'horizontal', line: lines[0]?.id }),
      expect.objectContaining({ kind: 'horizontal', line: lines[2]?.id }),
      expect.objectContaining({ kind: 'vertical', line: lines[1]?.id }),
      expect.objectContaining({ kind: 'vertical', line: lines[3]?.id }),
      expect.objectContaining({ kind: 'midpoint', point: points[0]?.id, line: lines[4]?.id }),
    ]);
  });

  it('the constraints of the shape are required: a conflict drops only the inferred ones', async () => {
    const { viewport, session, solver } = await drawing('sketch.rectangleCenter', LINE_AT_25);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });

    await clicks(viewport, [
      [20, 10],
      [30, 25],
    ]);

    expect(added(session, 'line', LINE_AT_25)).toHaveLength(5);
    expect(kindsOf(session)).toEqual(RECTANGLE_CENTER_KINDS);
  });

  it('corners on a line get pointOnCurve (automatic); with Ctrl/Cmd none', async () => {
    const first = await drawing('sketch.rectangleCenter', LINE_AT_25);
    await clicks(first.viewport, [
      [20, 10],
      [30, 25],
    ]);
    expect(kindsOf(first.session)).toEqual([
      'pointOnCurve',
      'pointOnCurve',
      ...RECTANGLE_CENTER_KINDS,
    ]);

    const second = await drawing('sketch.rectangleCenter', LINE_AT_25);
    await click(second.viewport, [20, 10], { mod: true });
    await click(second.viewport, [30, 25], { mod: true });
    expect(kindsOf(second.session)).toEqual(RECTANGLE_CENTER_KINDS);
  });

  it('a centre and a corner on existing points use their ids', async () => {
    const sketch = data([
      { kind: 'point', id: 'm', x: 50, y: 50 },
      { kind: 'point', id: 'k', x: 60, y: 70 },
    ]);
    const { viewport, session } = await drawing('sketch.rectangleCenter', sketch);

    await clicks(viewport, [
      [50, 50],
      [60, 70],
    ]);

    const lines = added(session, 'line', sketch);
    expect(lines[1]?.p2).toBe('k');
    expect(constraintsOf(session)).toContainEqual(
      expect.objectContaining({ kind: 'midpoint', point: 'm', line: lines[4]?.id }),
    );
    expect(added(session, 'point', sketch)).toHaveLength(3);
  });

  it('a computed corner snaps onto an existing point there', async () => {
    const sketch = data([{ kind: 'point', id: 'q', x: 10, y: 5 }]);
    const { viewport, session } = await drawing('sketch.rectangleCenter', sketch);

    await clicks(viewport, [
      [20, 20],
      [30, 35],
    ]);

    const [ab] = added(session, 'line', sketch);
    expect(ab?.p1).toBe('q');
    expect(added(session, 'point', sketch)).toHaveLength(4);
  });

  it('a corner with the x or y of the centre makes nothing and the centre stays', async () => {
    const { viewport, session, manager } = await drawing('sketch.rectangleCenter');

    await clicks(viewport, [
      [20, 20],
      [20, 30],
      [40, 20],
    ]);
    expect(entitiesOf(session)).toEqual([]);
    expect(manager.active.get()).toBe('sketch.rectangleCenter');

    await clicks(viewport, [[30, 25]]);
    expect(xyOf(session, added(session, 'point')[0]?.id ?? '')).toEqual([20, 20]);
  });

  it('Escape forgets the centre, a second Escape returns to sketch.select', async () => {
    const { viewport, session, manager } = await drawing('sketch.rectangleCenter');
    await clicks(viewport, [[20, 20]]);
    move(viewport, [30, 25]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.rectangleCenter');
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);

    await clicks(viewport, [
      [50, 50],
      [60, 60],
    ]);
    expect(xyOf(session, added(session, 'point')[0]?.id ?? '')).toEqual([50, 50]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.select');
  });

  it('previews the rectangle with its diagonal; a degenerate one is not drawn', async () => {
    const { viewport } = await drawing('sketch.rectangleCenter');
    await clicks(viewport, [[20, 20]]);

    move(viewport, [30, 25]);
    expect(previewPoints(viewport)).toBe(10);
    const [shape] = viewport.overlayShapes.get('sketch-tool') ?? [];
    expect(shape?.points[0]).toEqual([10, 15, 0]);

    move(viewport, [20, 30]);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
  });

  it('previews the inferred constraints of the corners', async () => {
    const { viewport, session } = await drawing('sketch.rectangleCenter', LINE_AT_25);
    await clicks(viewport, [[20, 10]]);

    move(viewport, [30, 25]);
    expect(inferenceOf(session)).toEqual({
      anchor: [30, 25, 0],
      kinds: ['pointOnCurve', 'pointOnCurve'],
    });

    move(viewport, [30, 25], { mod: true });
    expect(inferenceOf(session)).toBeNull();
  });
});

describe('the 3-point rectangle tool', () => {
  it('a horizontal side and a height make 4 lines, perpendicular, 2× parallel and horizontal', async () => {
    const { viewport, session } = await drawing('sketch.rectangle3p');

    await clicks(viewport, [
      [10, 10],
      [40, 10],
      [25, 30],
    ]);

    expect(added(session, 'point').map((p) => [p.x, p.y])).toEqual([
      [10, 10],
      [40, 10],
      [40, 30],
      [10, 30],
    ]);
    expect(linesAt(session).map((l) => [l.from, l.to])).toEqual([
      [
        [10, 10],
        [40, 10],
      ],
      [
        [40, 10],
        [40, 30],
      ],
      [
        [40, 30],
        [10, 30],
      ],
      [
        [10, 30],
        [10, 10],
      ],
    ]);
    const [ab, bc, cd, da] = added(session, 'line').map((l) => l.id);
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'perpendicular', a: ab, b: bc }),
      expect.objectContaining({ kind: 'parallel', a: cd, b: ab }),
      expect.objectContaining({ kind: 'parallel', a: da, b: bc }),
      expect.objectContaining({ kind: 'horizontal', line: ab }),
    ]);
  });

  it('a rotated side gets no axis; the height is perpendicular to it on either side', async () => {
    const { viewport, session } = await drawing('sketch.rectangle3p');

    // ab = (30, 40), its left normal (−0.8, 0.6); the third click 10 to the left of b.
    await clicks(viewport, [
      [10, 10],
      [40, 50],
      [32, 56],
    ]);
    // The third click 10 to the right of b: a negative height.
    await clicks(viewport, [
      [110, 210],
      [140, 250],
      [148, 244],
    ]);

    const corners = added(session, 'point').map((p): Vec2 => [p.x, p.y]);
    const expected: readonly Vec2[] = [
      [10, 10],
      [40, 50],
      [32, 56],
      [2, 16],
      [110, 210],
      [140, 250],
      [148, 244],
      [118, 204],
    ];
    expect(corners).toHaveLength(expected.length);
    expected.forEach(([x, y], i) => {
      expect(corners[i]?.[0]).toBeCloseTo(x, 9);
      expect(corners[i]?.[1]).toBeCloseTo(y, 9);
    });
    expect(kindsOf(session)).toEqual([...RECTANGLE_3P_KINDS, ...RECTANGLE_3P_KINDS]);
  });

  it('perpendicular and parallel are required, the axis of the side is not', async () => {
    const { viewport, session, solver } = await drawing('sketch.rectangle3p');
    solver.next({ status: 'conflict', entities: null, conflicting: [] });

    await clicks(viewport, [
      [10, 10],
      [40, 10],
      [25, 30],
    ]);

    expect(kindsOf(session)).toEqual(RECTANGLE_3P_KINDS);
  });

  it('a side within 3° of an axis gets it; with Ctrl/Cmd not', async () => {
    const first = await drawing('sketch.rectangle3p');
    await clicks(first.viewport, [
      [10, 10],
      [10, 50],
      [30, 30],
    ]);
    expect(kindsOf(first.session)).toEqual([...RECTANGLE_3P_KINDS, 'vertical']);

    const second = await drawing('sketch.rectangle3p');
    await click(second.viewport, [10, 10], { mod: true });
    await click(second.viewport, [40, 11], { mod: true });
    await click(second.viewport, [25, 30], { mod: true });
    expect(kindsOf(second.session)).toEqual(RECTANGLE_3P_KINDS);
  });

  it('an alignment of the second corner with an existing first one becomes the axis', async () => {
    const { viewport, session } = await drawing('sketch.rectangle3p', LONE_POINT);

    await clicks(viewport, [
      [50, 50],
      [80, 52],
      [70, 70],
    ]);

    const [ab] = added(session, 'line', LONE_POINT);
    expect(ab?.p1).toBe('m');
    expect(xyOf(session, ab?.p2 ?? '')).toEqual([80, 50]);
    expect(kindsOf(session)).toEqual([...RECTANGLE_3P_KINDS, 'horizontal']);
  });

  it('a computed corner snaps onto an existing point there', async () => {
    const sketch = data([{ kind: 'point', id: 'q', x: 40, y: 30 }]);
    const { viewport, session } = await drawing('sketch.rectangle3p', sketch);

    await clicks(viewport, [
      [10, 10],
      [40, 10],
      [25, 30],
    ]);

    const [, bc] = added(session, 'line', sketch);
    expect(bc?.p2).toBe('q');
    expect(added(session, 'point', sketch)).toHaveLength(3);
  });

  it('a second corner on the first or a height of 0 makes nothing and the work stays', async () => {
    const { viewport, session, manager } = await drawing('sketch.rectangle3p');

    await clicks(viewport, [
      [10, 10],
      [10, 10],
      [40, 10],
      [60, 10],
    ]);
    expect(entitiesOf(session)).toEqual([]);
    expect(manager.active.get()).toBe('sketch.rectangle3p');

    await clicks(viewport, [[25, 30]]);
    expect(added(session, 'line')).toHaveLength(4);
  });

  it('Escape forgets the side, a second Escape returns to sketch.select', async () => {
    const { viewport, session, manager } = await drawing('sketch.rectangle3p');
    await clicks(viewport, [
      [10, 10],
      [40, 10],
    ]);
    move(viewport, [25, 30]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.rectangle3p');
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
    await clicks(viewport, [[25, 30]]);
    expect(entitiesOf(session)).toEqual([]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.rectangle3p');
    escape(viewport);
    expect(manager.active.get()).toBe('sketch.select');
  });

  it('previews the side, then the rectangle; a degenerate one is not drawn', async () => {
    const { viewport } = await drawing('sketch.rectangle3p');
    await clicks(viewport, [[10, 10]]);

    move(viewport, [40, 10]);
    expect(previewPoints(viewport)).toBe(2);

    await clicks(viewport, [[40, 10]]);
    move(viewport, [25, 30]);
    expect(previewPoints(viewport)).toBe(8);

    move(viewport, [60, 10]);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
  });

  it('previews the axis of the side and the inferences of the computed corners', async () => {
    const { viewport, session } = await drawing('sketch.rectangle3p', LINE_AT_25);
    await clicks(viewport, [[10, 10]]);

    move(viewport, [40, 11]);
    expect(inferenceOf(session)).toEqual({ anchor: [40, 11, 0], kinds: ['horizontal'] });

    await clicks(viewport, [[40, 11]]);
    move(viewport, [30, 40]);
    expect(inferenceOf(session)).toBeNull();
    move(viewport, [30, 25]);
    expect(inferenceOf(session)?.kinds).toEqual(['pointOnCurve', 'pointOnCurve']);
  });
});
