import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Vec2 } from '@/core';
import { ORIGIN_PLANE_IDS, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamSchema } from '@/document';
import { aFakeOps } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, parseSketchData } from '@/sketch';
import type { SketchData, SketchEntity } from '@/sketch';
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
import type { KeyMods, ToolContext, ViewPointerEvent } from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import { createSketchEditor } from '@/sketcher/sketch-editor';
import type { SketchSession } from '@/sketcher/sketch-session';
import { createSketchTools } from '@/sketcher/sketch-tools';

// The tangent arc of the polyline (spec 12, "Tečný oblouk v polyline"): a press on the last point
// of the chain of the line tool dragged past the click tolerance draws an arc tangent to the
// previous line or arc of the chain; the chain goes on from its end.

function expectNear(actual: Vec2, expected: Vec2): void {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
}

// The harness: an open sketch with the sketch tools. In the default top view of FakeViewport
// px = the local XY of the plane XY; the snap tolerance is 6 px, the grid step 1.

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

/** An open new sketch with `sketch` written into it, after the first solve. */
async function sketching(opts: { sketch?: SketchData } = {}) {
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
  const fake = createFakeSolver();
  const viewport = new FakeViewport();
  const sketches = createSketchEditor({
    features: editor,
    solver: fake,
    geometry: createFakeSketchGeometry(),
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
  if (opts.sketch !== undefined) await session.addGeometry(opts.sketch);
  await settle();
  return { solver: fake, viewport, manager, session };
}

function pointer(type: ViewPointerEvent['type'], x: number, y: number, mods: Partial<KeyMods>) {
  return {
    type,
    x,
    y,
    button: type === 'move' || type === 'leave' ? null : ('left' as const),
    mods: { ...NO_MODS, ...mods },
  };
}

function move(viewport: FakeViewport, x: number, y: number, mods: Partial<KeyMods> = {}) {
  viewport.emitPointer(pointer('move', x, y, mods));
}

/** Clicks the points in order and lets the writes settle. */
async function clicks(
  viewport: FakeViewport,
  points: readonly Vec2[],
  mods: Partial<KeyMods> = {},
): Promise<void> {
  for (const [x, y] of points) {
    viewport.emitPointer(pointer('move', x, y, mods));
    viewport.emitPointer(pointer('down', x, y, mods));
    viewport.emitPointer(pointer('up', x, y, mods));
    await settle();
  }
}

function escape(viewport: FakeViewport): void {
  viewport.emitKey({ key: 'Escape', mods: NO_MODS, inTextField: false });
}

const arcsOf = (s: SketchSession) =>
  s.state
    .get()
    .entities.filter((e): e is Extract<SketchEntity, { kind: 'arc' }> => e.kind === 'arc');

function xyOf(s: SketchSession, id: string): Vec2 {
  const p = s.state.get().entities.find((e) => e.id === id);
  if (p?.kind !== 'point') throw new Error(`no point ${id}`);
  return [p.x, p.y];
}

/** The constraints of the session without their ids. */
const constraintsOf = (s: SketchSession) =>
  s.state.get().constraints.map((c) => ({ ...c, id: undefined }));

const inferenceOf = (s: SketchSession) => s.state.get().inference;

/** Presses at `from`, drags over `path` and releases at its last point (no settle). */
function drag(
  viewport: FakeViewport,
  from: Vec2,
  path: readonly Vec2[],
  mods: Partial<KeyMods> = {},
) {
  viewport.emitPointer(pointer('move', from[0], from[1], mods));
  viewport.emitPointer(pointer('down', from[0], from[1], mods));
  for (const [x, y] of path) viewport.emitPointer(pointer('move', x, y, mods));
  const [x, y] = path.at(-1) ?? from;
  viewport.emitPointer(pointer('up', x, y, mods));
}

const linesOf = (s: SketchSession) =>
  s.state
    .get()
    .entities.filter((e): e is Extract<SketchEntity, { kind: 'line' }> => e.kind === 'line');

/** The only arc of the session. */
function theArc(session: SketchSession) {
  const arcs = arcsOf(session);
  const arc = arcs[0];
  if (arcs.length !== 1 || arc === undefined) throw new Error(`${String(arcs.length)} arcs`);
  return arc;
}

/** The point of the session at (x, y). */
function pointAt(s: SketchSession, x: number, y: number): string {
  const p = s.state.get().entities.find((e) => e.kind === 'point' && e.x === x && e.y === y);
  if (p === undefined) throw new Error(`no point at ${String(x)}, ${String(y)}`);
  return p.id;
}

/** The line tool with the chain (10, 10) → (30, 10): one horizontal line, the chain at (30, 10). */
async function chained() {
  const s = await sketching();
  s.manager.activate('sketch.line');
  await clicks(s.viewport, [
    [10, 10],
    [30, 10],
  ]);
  return s;
}

describe('the tangent arc of the polyline', () => {
  it('a drag from the last point draws an arc tangent to the previous line', async () => {
    const { viewport, session, manager } = await chained();
    const line = linesOf(session)[0]?.id;

    drag(
      viewport,
      [30, 10],
      [
        [35, 12],
        [40, 20],
      ],
    );
    await settle();

    const arc = theArc(session);
    expect(arc.start).toBe(pointAt(session, 30, 10));
    expect(xyOf(session, arc.end)).toEqual([40, 20]);
    expectNear(xyOf(session, arc.center), [30, 20]);
    expect(constraintsOf(session)).toEqual([
      { kind: 'horizontal', line },
      { kind: 'tangent', a: arc.id, b: line },
    ]);
    expect(manager.active.get()).toBe('sketch.line');
  });

  it('in the construction mode the arc is construction, its constraints unchanged (M31)', async () => {
    const { viewport, session } = await chained();
    session.setConstructionMode(true);
    const line = linesOf(session)[0]?.id;

    drag(
      viewport,
      [30, 10],
      [
        [35, 12],
        [40, 20],
      ],
    );
    await settle();

    const arc = theArc(session);
    expect(arc.construction).toBe(true);
    expect(linesOf(session)[0]?.construction).not.toBe(true);
    expect(constraintsOf(session)).toEqual([
      { kind: 'horizontal', line },
      { kind: 'tangent', a: arc.id, b: line },
    ]);
  });

  it('tangent is required: it stays when the solver finds a conflict in everything', async () => {
    const { viewport, session, solver } = await chained();
    const line = linesOf(session)[0]?.id;
    // The end lands on the line from (30, 30) to (50, 30) (pointOnCurve), written before.
    const other = data([
      { kind: 'point', id: 'k1', x: 30, y: 50 },
      { kind: 'point', id: 'k2', x: 50, y: 50 },
      { kind: 'line', id: 'k', p1: 'k1', p2: 'k2' },
    ]);
    await session.addGeometry(other);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });

    drag(viewport, [30, 10], [[40, 50]]);
    await settle();

    const arc = theArc(session);
    expect(constraintsOf(session)).toEqual([
      { kind: 'horizontal', line },
      { kind: 'tangent', a: arc.id, b: line },
    ]);
  });

  it('the chain goes on from the end of the arc; the next line gets tangent to the arc', async () => {
    const { viewport, session } = await chained();

    drag(viewport, [30, 10], [[40, 20]]);
    await settle();
    await clicks(viewport, [[40, 40]]);

    const arc = theArc(session);
    const next = linesOf(session)[1];
    expect(next?.p1).toBe(arc.end);
    expect(xyOf(session, next?.p2 ?? '')).toEqual([40, 40]);
    expect(constraintsOf(session).slice(2)).toEqual([
      { kind: 'vertical', line: next?.id },
      { kind: 'tangent', a: next?.id, b: arc.id },
    ]);
  });

  it('an arc ending on the first point of the chain closes and ends it', async () => {
    const { viewport, session } = await chained();
    await clicks(viewport, [[30, 30]]);

    drag(viewport, [30, 30], [[10, 10]]);
    await settle();
    expect(theArc(session).end).toBe(pointAt(session, 10, 10));
    // The chain has ended: the next click only starts a new one.
    await clicks(viewport, [[50, 50]]);
    expect(linesOf(session)).toHaveLength(2);
  });

  it('a clockwise arc swaps its ends in the data; the chain goes on from the point at the cursor', async () => {
    const { viewport, session } = await chained();

    drag(viewport, [30, 10], [[40, 0]]);
    await settle();
    await clicks(viewport, [[40, -20]]);

    const arc = theArc(session);
    expect(xyOf(session, arc.start)).toEqual([40, 0]);
    expect(arc.end).toBe(pointAt(session, 30, 10));
    expectNear(xyOf(session, arc.center), [30, 0]);
    expect(linesOf(session)[1]?.p1).toBe(arc.start);
  });

  it('an arc continues the previous arc of the chain', async () => {
    const { viewport, session } = await chained();

    drag(viewport, [30, 10], [[40, 20]]);
    await settle();
    // At (40, 20) the arc goes on in +y; (30, 30) is on its left.
    drag(viewport, [40, 20], [[30, 30]]);
    await settle();

    const [first, second] = arcsOf(session);
    expect(second?.start).toBe(first?.end);
    expectNear(xyOf(session, second?.center ?? ''), [30, 20]);
    expect(constraintsOf(session).at(-1)).toEqual({ kind: 'tangent', a: second?.id, b: first?.id });
  });

  it('without a previous curve (only the first point) the drag does nothing', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.line');
    await clicks(viewport, [[10, 10]]);

    drag(viewport, [10, 10], [[20, 20]]);
    await settle();
    expect(session.state.get().entities).toEqual([]);

    // The chain is still there: a click adds the line from the first point.
    await clicks(viewport, [[30, 20]]);
    expect(linesOf(session)).toHaveLength(1);
  });

  it('a drag that does not start on the last point does nothing', async () => {
    const { viewport, session } = await chained();

    drag(viewport, [20, 30], [[40, 20]]);
    await settle();

    expect(arcsOf(session)).toEqual([]);
    expect(linesOf(session)).toHaveLength(1);
  });

  it('Escape during the drag cancels it; the chain stays', async () => {
    const { manager, viewport, session } = await chained();

    viewport.emitPointer(pointer('down', 30, 10, {}));
    move(viewport, 40, 20);
    escape(viewport);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
    expect(inferenceOf(session)).toBeNull();
    viewport.emitPointer(pointer('up', 40, 20, {}));
    await settle();

    expect(arcsOf(session)).toEqual([]);
    expect(manager.active.get()).toBe('sketch.line');
    await clicks(viewport, [[30, 30]]);
    const lines = linesOf(session);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.p1).toBe(pointAt(session, 30, 10));
  });

  it('an end on the line of the direction makes nothing; the chain stays', async () => {
    const { viewport, session } = await chained();

    drag(viewport, [30, 10], [[50, 10]]);
    await settle();
    expect(arcsOf(session)).toEqual([]);

    await clicks(viewport, [[30, 30]]);
    expect(linesOf(session)[1]?.p1).toBe(pointAt(session, 30, 10));
  });

  it('previews the arc and tangent during the drag; a degenerate arc is not drawn', async () => {
    const { viewport, session } = await chained();

    viewport.emitPointer(pointer('down', 30, 10, {}));
    move(viewport, 40, 20);
    const points = viewport.overlayShapes.get('sketch-tool')?.[0]?.points ?? [];
    // A quarter turn of 64 segments per turn: 16 segments as pairs.
    expect(points).toHaveLength(32);
    for (const [x = NaN, y = NaN] of points) expect(Math.hypot(x - 30, y - 20)).toBeCloseTo(10, 9);
    expect(inferenceOf(session)).toEqual({ anchor: [40, 20, 0], kinds: ['tangent'] });

    move(viewport, 50, 10);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
    expect(inferenceOf(session)).toBeNull();

    move(viewport, 40, 20);
    viewport.emitPointer(pointer('up', 40, 20, {}));
    expect(inferenceOf(session)).toBeNull();
  });
});

// The numeric input of the line tool (spec 12, "Číselný vstup (M32)"): the first point x, y, a
// next point length, angle; locked values become required constraints.

const DEG = Math.PI / 180;

/** Types the keys into the view one by one (a string: each character; longer names whole). */
function type(viewport: FakeViewport, keys: readonly string[]): void {
  for (const key of keys) viewport.emitKey({ key, mods: NO_MODS, inTextField: false });
}

const chars = (text: string): readonly string[] => Array.from(text);

describe('the numeric input of the line tool (M32)', () => {
  it('50 mm under 30° only from the keyboard: the points and a required distance 50', async () => {
    const { viewport, session, manager } = await sketching();
    manager.activate('sketch.line');
    move(viewport, 70, 3);
    type(viewport, [...chars('10'), 'Tab', ...chars('10'), 'Enter']);
    type(viewport, [...chars('50'), 'Tab', ...chars('30'), 'Enter']);
    await settle();

    const [line] = linesOf(session);
    if (line === undefined) throw new Error('no line');
    expect(xyOf(session, line.p1)).toEqual([10, 10]);
    expectNear(xyOf(session, line.p2), [
      10 + 50 * Math.cos(30 * DEG),
      10 + 50 * Math.sin(30 * DEG),
    ]);
    expect(constraintsOf(session)).toEqual([
      { kind: 'distance', a: line.p1, b: line.p2, value: 50 },
    ]);
  });

  it('shows x, y for the first point and length, angle for a next one', async () => {
    const { viewport, session, manager } = await sketching();
    manager.activate('sketch.line');
    move(viewport, 30, 40);
    expect(session.state.get().numericInput?.fields.map((f) => [f.id, f.text])).toEqual([
      ['x', '30.00'],
      ['y', '40.00'],
    ]);

    await clicks(viewport, [[10, 10]]);
    move(viewport, 10, 30);
    expect(session.state.get().numericInput?.fields.map((f) => [f.id, f.text])).toEqual([
      ['length', '20.00'],
      ['angle', '90.00'],
    ]);
  });

  it('an angle of 0° is horizontal instead of the automatic axis', async () => {
    const { viewport, session, manager } = await sketching();
    manager.activate('sketch.line');
    await clicks(viewport, [[10, 10]]);
    move(viewport, 40, 20);
    type(viewport, ['Tab', '0', 'Enter']);
    await settle();

    const [line] = linesOf(session);
    if (line === undefined) throw new Error('no line');
    expect(xyOf(session, line.p2)).toEqual([40, 10]);
    expect(constraintsOf(session)).toEqual([{ kind: 'horizontal', line: line.id }]);
  });

  it('an angle of 90° is vertical; the preview shows it', async () => {
    const { viewport, session, manager } = await sketching();
    manager.activate('sketch.line');
    await clicks(viewport, [[10, 10]]);
    move(viewport, 40, 20);
    type(viewport, ['Tab', ...chars('90')]);
    expect(inferenceOf(session)?.kinds).toEqual(['vertical']);

    type(viewport, ['Enter']);
    await settle();

    const [line] = linesOf(session);
    expect(xyOf(session, line?.p2 ?? '')).toEqual([10, 20]);
    expect(constraintsOf(session)).toEqual([{ kind: 'vertical', line: line?.id }]);
  });

  it('an angle off the axes on a first line has no dimension and no automatic axis', async () => {
    const { viewport, session, manager } = await sketching();
    manager.activate('sketch.line');
    await clicks(viewport, [[10, 10]]);
    move(viewport, 40, 11);
    type(viewport, [...chars('20'), 'Tab', '2', 'Enter']);
    await settle();

    const [line] = linesOf(session);
    if (line === undefined) throw new Error('no line');
    expectNear(xyOf(session, line.p2), [10 + 20 * Math.cos(2 * DEG), 10 + 20 * Math.sin(2 * DEG)]);
    expect(constraintsOf(session)).toEqual([
      { kind: 'distance', a: line.p1, b: line.p2, value: 20 },
    ]);
  });

  it('an angle off the axes after a line of the chain is an angle dimension between them', async () => {
    const { viewport, session } = await chained();
    const previous = linesOf(session)[0];
    move(viewport, 40, 40);
    // 20 = the previous length: equal would be inferred, but the locked length replaces it.
    type(viewport, [...chars('20'), 'Tab', ...chars('60'), 'Enter']);
    await settle();

    const line = linesOf(session)[1];
    if (line === undefined || previous === undefined) throw new Error('no lines');
    expectNear(xyOf(session, line.p2), [
      30 + 20 * Math.cos(60 * DEG),
      10 + 20 * Math.sin(60 * DEG),
    ]);
    const [horizontal, distance, angle] = constraintsOf(session);
    expect(horizontal).toEqual({ kind: 'horizontal', line: previous.id });
    expect(distance).toEqual({ kind: 'distance', a: line.p1, b: line.p2, value: 20 });
    // The rays from (30, 10): back along the previous line and along the new one, 120°.
    expect(angle).toMatchObject({ kind: 'angle', a: previous.id, b: line.id, reverseA: true });
    expect(angle?.kind === 'angle' ? angle.value : null).toBeCloseTo(120 * DEG, 9);
    expect(constraintsOf(session)).toHaveLength(3);
  });

  it('a locked length with the direction from the mouse', async () => {
    const { viewport, session } = await chained();
    type(viewport, [...chars('25'), 'Tab']);
    await clicks(viewport, [[31, 60]]);

    const line = linesOf(session)[1];
    if (line === undefined) throw new Error('no line');
    const d = Math.hypot(1, 50);
    expectNear(xyOf(session, line.p2), [30 + (25 * 1) / d, 10 + (25 * 50) / d]);
    expect(constraintsOf(session).slice(1)).toEqual([
      { kind: 'vertical', line: line.id },
      { kind: 'distance', a: line.p1, b: line.p2, value: 25 },
    ]);
  });

  it('a typed point is not snapped: next to an existing point it is a new one', async () => {
    const { viewport, session } = await chained();
    move(viewport, 10, 12);
    type(viewport, [...chars('20'), 'Tab', ...chars('180'), 'Enter']);
    await settle();

    const line = linesOf(session)[1];
    if (line === undefined) throw new Error('no line');
    expect(line.p2).not.toBe(linesOf(session)[0]?.p1);
    expectNear(xyOf(session, line.p2), [10, 10]);
  });

  it('the typed constraints are required: a conflict drops only the automatic ones', async () => {
    const { viewport, session, solver } = await chained();
    // The direction from the mouse: vertical is inferred (within 3°), automatic.
    type(viewport, [...chars('20'), 'Tab']);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });
    await clicks(viewport, [[31, 60]]);

    const line = linesOf(session)[1];
    if (line === undefined) throw new Error('no line');
    expect(constraintsOf(session).slice(1)).toEqual([
      { kind: 'distance', a: line.p1, b: line.p2, value: 20 },
    ]);
  });
});

describe('the locked fields replace the automatic inferences (M32)', () => {
  it('a locked angle drops the automatic parallel, perpendicular and axis', async () => {
    const { viewport, session } = await chained();
    // 91° from the end of the horizontal line: perpendicular and vertical within 3° by the mouse.
    move(viewport, 30, 40);
    type(viewport, ['Tab', ...chars('91')]);
    expect(inferenceOf(session)?.kinds ?? []).toEqual([]);
    type(viewport, ['Enter']);
    await settle();

    const line = linesOf(session)[1];
    if (line === undefined) throw new Error('no line');
    expect(
      constraintsOf(session)
        .slice(1)
        .map((c) => c.kind),
    ).toEqual(['angle']);
  });

  it('a locked length drops the automatic equal; the direction stays automatic', async () => {
    const { viewport, session } = await chained();
    type(viewport, [...chars('20'), 'Tab']);
    await clicks(viewport, [[60, 41]]);

    const line = linesOf(session)[1];
    if (line === undefined) throw new Error('no line');
    expect(constraintsOf(session).slice(1)).toEqual([
      { kind: 'distance', a: line.p1, b: line.p2, value: 20 },
    ]);
  });

  it('without locked fields the line keeps equal and the axis', async () => {
    const { viewport, session } = await chained();
    await clicks(viewport, [[30, 30]]);

    expect(
      constraintsOf(session)
        .slice(1)
        .map((c) => c.kind),
    ).toEqual(['vertical', 'equal']);
  });
});

describe('a refused line of the numeric input (M32)', () => {
  it('resets the chain: the next move shows x and y again', async () => {
    const { viewport, session, manager, solver } = await sketching();
    manager.activate('sketch.line');
    await clicks(viewport, [[10, 10]]);
    // Only required constraints: a conflict refuses the line.
    type(viewport, [...chars('20'), 'Tab']);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });
    await clicks(viewport, [[40, 50]]);
    expect(linesOf(session)).toEqual([]);

    move(viewport, 7, 8);
    expect(session.state.get().numericInput?.fields.map((f) => [f.id, f.text])).toEqual([
      ['x', '7.00'],
      ['y', '8.00'],
    ]);
  });
});
