import { describe, expect, it } from 'vitest';
import { bspline, createSequentialIdGenerator } from '@/core';
import type { Vec2 } from '@/core';
import { ORIGIN_PLANE_IDS, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, parseSketchData } from '@/sketch';
import type { SketchBSpline, SketchData, SketchEntity, SketchFitSpline } from '@/sketch';
import { createFakeSolver } from '@/sketch/testing';
import {
  SELECT_TOOL,
  createFeatureEditor,
  createSelectionModel,
  createToolManager,
  createToolRegistry,
} from '@/interaction';
import type { KeyMods, PickResult, ToolContext, ViewPointerEvent } from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import { createSketchEditor } from '@/sketcher/sketch-editor';
import type { SketchSession } from '@/sketcher/sketch-session';
import { createSketchTools } from '@/sketcher/sketch-tools';

// The spline tools sketch.spline and sketch.fitSpline (spec 12, "Spliny (M29)", "Nástroje"). In
// the default top view of FakeViewport px = the local XY of the plane XY; the grid (step 1) is on.

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

/** A horizontal line from (0, 50) to (100, 50). */
const LINE = data([
  { kind: 'point', id: 'l1', x: 0, y: 50 },
  { kind: 'point', id: 'l2', x: 100, y: 50 },
  { kind: 'line', id: 'l', p1: 'l1', p2: 'l2' },
]);

/** An open new sketch with `sketch` written into it; nothing picks (the tools snap, not pick). */
async function sketching(sketch?: SketchData) {
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
  viewport.setPick((): PickResult | null => null);
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
  return { viewport, manager, session, solver };
}

/** Lets the solver answers (microtasks) and the queue settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function pointer(
  type: ViewPointerEvent['type'],
  x: number,
  y: number,
  mods: Partial<KeyMods> = {},
): ViewPointerEvent {
  return {
    type,
    x,
    y,
    button: type === 'move' || type === 'leave' ? null : 'left',
    mods: { ...NO_MODS, ...mods },
  };
}

function move(viewport: FakeViewport, x: number, y: number, mods: Partial<KeyMods> = {}): void {
  viewport.emitPointer(pointer('move', x, y, mods));
}

function click(viewport: FakeViewport, x: number, y: number, mods: Partial<KeyMods> = {}): void {
  move(viewport, x, y, mods);
  viewport.emitPointer(pointer('down', x, y, mods));
  viewport.emitPointer(pointer('up', x, y, mods));
}

/** Clicks the points in order and lets the writes settle. */
async function clicks(
  viewport: FakeViewport,
  points: readonly Vec2[],
  mods: Partial<KeyMods> = {},
): Promise<void> {
  for (const [x, y] of points) {
    click(viewport, x, y, mods);
    await settle();
  }
}

function key(viewport: FakeViewport, k: string, mods: Partial<KeyMods> = {}): void {
  viewport.emitKey({ key: k, mods: { ...NO_MODS, ...mods }, inTextField: false });
}

async function enter(viewport: FakeViewport): Promise<void> {
  key(viewport, 'Enter');
  await settle();
}

const entitiesOf = (s: SketchSession): readonly SketchEntity[] => s.state.get().entities;
const pointsOf = (s: SketchSession) =>
  entitiesOf(s).filter((e): e is Extract<SketchEntity, { kind: 'point' }> => e.kind === 'point');
const bsplinesOf = (s: SketchSession) =>
  entitiesOf(s).filter((e): e is SketchBSpline => e.kind === 'bspline');
const fitSplinesOf = (s: SketchSession) =>
  entitiesOf(s).filter((e): e is SketchFitSpline => e.kind === 'fitSpline');
const kindsOf = (s: SketchSession) => s.state.get().constraints.map((c) => c.kind);
const xyOf = (s: SketchSession, id: string): Vec2 | undefined => {
  const p = pointsOf(s).find((e) => e.id === id);
  return p === undefined ? undefined : [p.x, p.y];
};

const FOUR: readonly Vec2[] = [
  [10, 10],
  [40, 60],
  [80, 20],
  [120, 70],
];

describe('the control point spline tool (sketch.spline)', () => {
  it('Enter writes a bspline through new points with clamped uniform knots', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.spline');

    await clicks(viewport, [...FOUR, [150, 35]]);
    expect(entitiesOf(session)).toEqual([]); // nothing is written before the end
    await enter(viewport);

    const points = pointsOf(session);
    expect(points.map((p) => [p.x, p.y])).toEqual([...FOUR, [150, 35]]);
    expect(bsplinesOf(session)).toEqual([
      expect.objectContaining({
        degree: 3,
        poles: points.map((p) => p.id),
        knots: [0, 0, 0, 0, 0.5, 1, 1, 1, 1],
      }),
    ]);
    expect(session.state.get().constraints).toEqual([]);
    expect(manager.active.get()).toBe('sketch.spline');
  });

  it('in the construction mode the bspline is construction (M31)', async () => {
    const { manager, viewport, session } = await sketching();
    session.setConstructionMode(true);
    manager.activate('sketch.spline');

    await clicks(viewport, FOUR);
    await enter(viewport);

    expect(bsplinesOf(session).map((b) => b.construction)).toEqual([true]);
    expect(pointsOf(session).map((p) => [p.x, p.y])).toEqual(FOUR);
  });

  it('the degree is min(3, n − 1): two points are a line, three a quadratic', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.spline');

    await clicks(viewport, FOUR.slice(0, 2));
    await enter(viewport);
    await clicks(viewport, [
      [10, 100],
      [50, 150],
      [90, 100],
    ]);
    await enter(viewport);

    expect(bsplinesOf(session).map(({ degree, knots }) => ({ degree, knots }))).toEqual([
      { degree: 1, knots: [0, 0, 1, 1] },
      { degree: 2, knots: [0, 0, 0, 1, 1, 1] },
    ]);
  });

  it('a click on its own last point ends it like Enter', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.spline');

    await clicks(viewport, [...FOUR, [121, 71]]);

    expect(bsplinesOf(session)).toHaveLength(1);
    expect(pointsOf(session)).toHaveLength(4);
    // The spline is over: the next clicks start a new one.
    await clicks(viewport, [
      [200, 10],
      [230, 40],
    ]);
    await enter(viewport);
    expect(bsplinesOf(session)).toHaveLength(2);
    expect(bsplinesOf(session)[1]?.poles).toHaveLength(2);
  });

  it('a click on its own first point with three points closes it with a required coincident', async () => {
    const { manager, viewport, session, solver } = await sketching(LINE);
    manager.activate('sketch.spline');

    // The first point on the line gets pointOnCurve.
    await clicks(viewport, [
      [30, 52],
      [40, 100],
      [80, 120],
    ]);
    // The solver finds a conflict in everything: pointOnCurve goes, the coincident stays.
    solver.next({ status: 'conflict', entities: null, conflicting: [] });
    await clicks(viewport, [[31, 51]]);

    const points = pointsOf(session).slice(2);
    expect(points).toHaveLength(4);
    const [spline] = bsplinesOf(session);
    expect(spline?.poles).toEqual(points.map((p) => p.id));
    expect(xyOf(session, points[3]?.id ?? '')).toEqual([30, 50]);
    expect(session.state.get().constraints).toEqual([
      expect.objectContaining({ kind: 'coincident', a: points[3]?.id, b: points[0]?.id }),
    ]);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
  });

  it('a click on another own point is ignored, so is the first one before three points', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.spline');

    await clicks(viewport, [FOUR[0] ?? [0, 0], FOUR[1] ?? [0, 0], [10, 10]]);
    await clicks(viewport, [FOUR[2] ?? [0, 0], [40, 60], FOUR[3] ?? [0, 0]]);
    expect(entitiesOf(session)).toEqual([]);
    await enter(viewport);

    expect(pointsOf(session).map((p) => [p.x, p.y])).toEqual(FOUR);
    expect(bsplinesOf(session)[0]?.poles).toHaveLength(4);
  });

  it('a snap onto an existing point uses its id', async () => {
    const { manager, viewport, session } = await sketching(LINE);
    manager.activate('sketch.spline');

    await clicks(viewport, [
      [1, 51],
      [40, 100],
      [99, 49],
    ]);
    await enter(viewport);

    const [spline] = bsplinesOf(session);
    expect(spline?.poles[0]).toBe('l1');
    expect(spline?.poles[2]).toBe('l2');
    expect(pointsOf(session)).toHaveLength(3);
  });

  it('a new point gets its inferred constraints, automatic', async () => {
    const { manager, viewport, session } = await sketching(LINE);
    manager.activate('sketch.spline');

    await clicks(viewport, [
      [30, 52],
      [60, 100],
    ]);
    await enter(viewport);

    const [, , first] = pointsOf(session);
    expect(xyOf(session, first?.id ?? '')).toEqual([30, 50]);
    expect(session.state.get().constraints).toEqual([
      expect.objectContaining({ kind: 'pointOnCurve', point: first?.id, curve: 'l' }),
    ]);
  });

  it('with Ctrl/Cmd the points get no inferred constraints', async () => {
    const { manager, viewport, session } = await sketching(LINE);
    manager.activate('sketch.spline');

    await clicks(
      viewport,
      [
        [30, 52],
        [60, 100],
      ],
      { mod: true },
    );
    await enter(viewport);

    expect(bsplinesOf(session)).toHaveLength(1);
    expect(kindsOf(session)).toEqual([]);
  });

  it('Escape cancels the spline, a second Escape returns to sketch.select', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.spline');
    await clicks(viewport, FOUR.slice(0, 3));
    move(viewport, 100, 100);

    key(viewport, 'Escape');
    await settle();

    expect(entitiesOf(session)).toEqual([]);
    expect(manager.active.get()).toBe('sketch.spline');
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
    await enter(viewport);
    expect(entitiesOf(session)).toEqual([]);

    key(viewport, 'Escape');
    expect(manager.active.get()).toBe('sketch.select');
  });

  it('fewer than two points write nothing', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.spline');

    await enter(viewport);
    await clicks(viewport, [[10, 10]]);
    await enter(viewport);
    expect(entitiesOf(session)).toEqual([]);

    // The ended spline is gone: the next one starts from scratch.
    await clicks(viewport, [
      [50, 50],
      [80, 90],
    ]);
    await enter(viewport);
    expect(pointsOf(session).map((p) => [p.x, p.y])).toEqual([
      [50, 50],
      [80, 90],
    ]);
  });

  it('Enter with a modifier does not end it', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.spline');
    await clicks(viewport, FOUR.slice(0, 2));

    key(viewport, 'Enter', { shift: true });
    await settle();

    expect(entitiesOf(session)).toEqual([]);
  });

  it('previews the curve through the points and the cursor with its control polygon', async () => {
    const { manager, viewport } = await sketching();
    manager.activate('sketch.spline');
    move(viewport, 10, 10);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
    await clicks(viewport, FOUR.slice(0, 2));

    move(viewport, 80, 20);

    const [shape] = viewport.overlayShapes.get('sketch-tool') ?? [];
    expect(shape).toMatchObject({ kind: 'lines', style: 'preview' });
    const points = shape?.points ?? [];
    // The control polygon: the pairs (10,10)–(40,60) and (40,60)–(80,20).
    const pairs = Array.from({ length: points.length / 2 }, (_, i) => [
      points[2 * i],
      points[2 * i + 1],
    ]);
    expect(pairs).toContainEqual([
      [10, 10, 0],
      [40, 60, 0],
    ]);
    expect(pairs).toContainEqual([
      [40, 60, 0],
      [80, 20, 0],
    ]);
    // The curve: more than the two segments of the polygon, from the first point to the cursor.
    expect(pairs.length).toBeGreaterThan(4);
    expect(points).toContainEqual([80, 20, 0]);

    await enter(viewport);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
  });

  it('previews the inferred constraints of the next point; Escape removes them', async () => {
    const { manager, viewport, session } = await sketching(LINE);
    manager.activate('sketch.spline');
    await clicks(viewport, [[30, 100]]);

    move(viewport, 60, 52);
    expect(session.state.get().inference).toEqual({
      anchor: [60, 50, 0],
      kinds: ['pointOnCurve'],
    });

    move(viewport, 60, 52, { mod: true });
    expect(session.state.get().inference).toBeNull();

    move(viewport, 60, 52);
    key(viewport, 'Escape');
    expect(session.state.get().inference).toBeNull();
  });

  it('deactivating the tool removes the preview and forgets the spline', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.spline');
    await clicks(viewport, FOUR.slice(0, 2));
    move(viewport, 80, 20);

    manager.activate('sketch.select');
    manager.activate('sketch.spline');
    await enter(viewport);

    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
    expect(entitiesOf(session)).toEqual([]);
  });
});

describe('the spline tool (sketch.fitSpline)', () => {
  it('Enter writes a fitSpline through the points by bspline.interpolate', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.fitSpline');

    await clicks(viewport, FOUR);
    await enter(viewport);

    const points = pointsOf(session);
    const { degree, params, knots, poles } = bspline.interpolate(FOUR);
    expect(fitSplinesOf(session)).toEqual([
      expect.objectContaining({
        fit: points.map((p) => p.id),
        degree,
        params,
        knots,
        poles,
      }),
    ]);
    expect(bsplinesOf(session)).toEqual([]);
  });

  it('closes on its own first point with a required coincident', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.fitSpline');

    await clicks(viewport, [...FOUR.slice(0, 3), [10, 10]]);

    const points = pointsOf(session);
    expect(points).toHaveLength(4);
    const [spline] = fitSplinesOf(session);
    expect(spline?.fit).toEqual(points.map((p) => p.id));
    expect(spline?.poles).toEqual(bspline.interpolate([...FOUR.slice(0, 3), [10, 10]]).poles);
    expect(kindsOf(session)).toEqual(['coincident']);
  });

  it('a click on its own last point ends it', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.fitSpline');

    await clicks(viewport, [...FOUR.slice(0, 3), [80, 20]]);

    expect(fitSplinesOf(session)).toHaveLength(1);
    expect(fitSplinesOf(session)[0]?.fit).toHaveLength(3);
  });

  it('previews the interpolated curve without a control polygon', async () => {
    const { manager, viewport } = await sketching();
    manager.activate('sketch.fitSpline');
    await clicks(viewport, FOUR.slice(0, 2));

    move(viewport, 80, 20);

    const points = viewport.overlayShapes.get('sketch-tool')?.[0]?.points ?? [];
    const pairs = Array.from({ length: points.length / 2 }, (_, i) => [
      points[2 * i],
      points[2 * i + 1],
    ]);
    expect(pairs).not.toContainEqual([
      [10, 10, 0],
      [40, 60, 0],
    ]);
    expect(points[0]).toEqual([10, 10, 0]);
    expect(points.at(-1)).toEqual([80, 20, 0]);
  });
});
