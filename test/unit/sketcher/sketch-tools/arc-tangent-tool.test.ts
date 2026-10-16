import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Vec2 } from '@/core';
import { ORIGIN_PLANE_IDS, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, parseSketchData } from '@/sketch';
import type { SketchData, SketchEntity } from '@/sketch';
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

// The tangent arc tool (spec 12, "Oblouky a kružnice (M27)"): an end point of an existing line or
// arc, then the end of the arc.

/**
 * The line l from (10, 10) to (30, 10), the counter-clockwise quarter arc a around (100, 100) from
 * (110, 100) to (100, 110) and a lone point m at (60, 60).
 */
const SKETCH = data([
  { kind: 'point', id: 'l1', x: 10, y: 10 },
  { kind: 'point', id: 'l2', x: 30, y: 10 },
  { kind: 'line', id: 'l', p1: 'l1', p2: 'l2' },
  { kind: 'point', id: 'ac', x: 100, y: 100 },
  { kind: 'point', id: 'as', x: 110, y: 100 },
  { kind: 'point', id: 'ae', x: 100, y: 110 },
  { kind: 'arc', id: 'a', center: 'ac', start: 'as', end: 'ae' },
  { kind: 'point', id: 'm', x: 60, y: 60 },
]);
const BEFORE = SKETCH.entities.length;

/** The point of the arc a at 45°, where a click at (108, 108) snaps onto it. */
const ON_ARC: Vec2 = [100 + 10 * Math.SQRT1_2, 100 + 10 * Math.SQRT1_2];

function expectNear(actual: Vec2, expected: Vec2): void {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
}

/** The arc the tool added (the last arc of the session). */
function newArc(session: SketchSession) {
  const arc = arcsOf(session).at(-1);
  if (arc === undefined || arc.id === 'a') throw new Error('no new arc');
  return arc;
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
  const ops = anOpsSession({ schemas });
  const editor = createFeatureEditor({
    doc: ops.doc,
    ops: ops.dispatcher,
    schemas,
    ids: createSequentialIdGenerator('f'),
    translate: (key) => key,
  });
  const fake = createFakeSolver();
  const viewport = new FakeViewport();
  const sketches = createSketchEditor({
    features: editor,
    solver: fake,
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

/** The entities the tool added after the `before` entities of the sketch. */
const addedOf = (s: SketchSession, before: number): readonly SketchEntity[] =>
  s.state.get().entities.slice(before);

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

describe('the tangent arc tool', () => {
  it('from the end of a line to a point on its left: a counter-clockwise arc with tangent', async () => {
    const { manager, viewport, session } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arcTangent');

    await clicks(viewport, [
      [30, 10],
      [40, 20],
    ]);

    expect(addedOf(session, BEFORE).map((e) => e.kind)).toEqual(['point', 'point', 'arc']);
    const arc = newArc(session);
    expect(arc.start).toBe('l2');
    expect(xyOf(session, arc.end)).toEqual([40, 20]);
    expectNear(xyOf(session, arc.center), [30, 20]);
    expect(constraintsOf(session)).toEqual([{ kind: 'tangent', a: arc.id, b: 'l' }]);
    expect(manager.active.get()).toBe('sketch.arcTangent');
  });

  it('to a point on the right the arc is clockwise: start and end swap in the data', async () => {
    const { manager, viewport, session } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arcTangent');

    await clicks(viewport, [
      [30, 10],
      [40, 0],
    ]);

    const arc = newArc(session);
    expect(xyOf(session, arc.start)).toEqual([40, 0]);
    expect(arc.end).toBe('l2');
    expectNear(xyOf(session, arc.center), [30, 0]);
  });

  it('from the start of a line it goes on away from the other end', async () => {
    const { manager, viewport, session } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arcTangent');

    // Past l1 the line goes on in −x; (−10, −10) is on its left.
    await clicks(viewport, [
      [10, 10],
      [-10, -10],
    ]);

    const arc = newArc(session);
    expect(arc.start).toBe('l1');
    expectNear(xyOf(session, arc.center), [10, -10]);
  });

  it('from the end of an arc it goes on in the sense of the arc, with tangent to the arc', async () => {
    const { manager, viewport, session } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arcTangent');

    // At (100, 110) the arc goes on in −x; (80, 90) is on the left.
    await clicks(viewport, [
      [100, 110],
      [80, 90],
    ]);

    const arc = newArc(session);
    expect(arc.start).toBe('ae');
    expectNear(xyOf(session, arc.center), [100, 90]);
    expect(constraintsOf(session)).toEqual([{ kind: 'tangent', a: arc.id, b: 'a' }]);
  });

  it('of several curves ending in the point the last one of the data is continued', async () => {
    // The line k from (100, 50) to (100, 110) ends in the end point of the arc a too, later.
    const both = data([
      ...SKETCH.entities,
      { kind: 'point', id: 'k1', x: 100, y: 50 },
      { kind: 'line', id: 'k', p1: 'k1', p2: 'ae' },
    ]);
    const { manager, viewport, session } = await sketching({ sketch: both });
    manager.activate('sketch.arcTangent');

    // Past ae the line goes on in +y; (90, 120) is on its left.
    await clicks(viewport, [
      [100, 110],
      [90, 120],
    ]);

    const arc = newArc(session);
    expectNear(xyOf(session, arc.center), [90, 110]);
    expect(constraintsOf(session)).toEqual([{ kind: 'tangent', a: arc.id, b: 'k' }]);
  });

  it('the end gets the inferred constraints of the snapper; tangent is required', async () => {
    const { manager, viewport, session, solver } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arcTangent');
    await clicks(viewport, [[30, 10]]);
    // The end lands on the arc a (pointOnCurve) at 45°; the solver finds a conflict in everything.
    solver.next({ status: 'conflict', entities: null, conflicting: [] });

    await clicks(viewport, [[108, 108]]);

    const arc = newArc(session);
    expectNear(xyOf(session, arc.end), ON_ARC);
    expect(constraintsOf(session)).toEqual([{ kind: 'tangent', a: arc.id, b: 'l' }]);
  });

  it('without a conflict the end keeps its pointOnCurve; with Ctrl/Cmd only tangent', async () => {
    const plain = await sketching({ sketch: SKETCH });
    plain.manager.activate('sketch.arcTangent');
    await clicks(plain.viewport, [
      [30, 10],
      [108, 108],
    ]);
    const arc = newArc(plain.session);
    expect(constraintsOf(plain.session)).toEqual([
      { kind: 'pointOnCurve', point: arc.end, curve: 'a' },
      { kind: 'tangent', a: arc.id, b: 'l' },
    ]);

    const ctrl = await sketching({ sketch: SKETCH });
    ctrl.manager.activate('sketch.arcTangent');
    await clicks(
      ctrl.viewport,
      [
        [30, 10],
        [108, 108],
      ],
      { mod: true },
    );
    const arc2 = newArc(ctrl.session);
    expect(constraintsOf(ctrl.session)).toEqual([{ kind: 'tangent', a: arc2.id, b: 'l' }]);
  });

  it('a click on a point that is no end of a line or an arc, or off any point, starts nothing', async () => {
    const { manager, viewport, session } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arcTangent');

    // The lone point m, the centre of a, the middle of l, empty space; then a would-be end.
    await clicks(viewport, [
      [60, 60],
      [100, 100],
      [20, 10],
      [150, 150],
      [40, 20],
    ]);

    expect(addedOf(session, BEFORE)).toEqual([]);
  });

  it('an end on the line of the direction makes nothing and the tool keeps its start', async () => {
    const { manager, viewport, session } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arcTangent');

    await clicks(viewport, [
      [30, 10],
      [50, 10],
      [30, 10],
    ]);
    expect(addedOf(session, BEFORE)).toEqual([]);

    await clicks(viewport, [[40, 20]]);
    expect(newArc(session).start).toBe('l2');
  });

  it('Escape forgets the start, a second Escape ends the tool', async () => {
    const { manager, viewport, session } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arcTangent');
    await clicks(viewport, [[30, 10]]);
    move(viewport, 40, 20);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.arcTangent');
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
    expect(inferenceOf(session)).toBeNull();
    await clicks(viewport, [[40, 20]]);
    expect(addedOf(session, BEFORE)).toEqual([]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.select');
  });

  it('previews the arc and tangent with the inferences of the end; a degenerate arc is not drawn', async () => {
    const { manager, viewport, session } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arcTangent');

    move(viewport, 30, 10);
    expect(inferenceOf(session)).toBeNull();
    await clicks(viewport, [[30, 10]]);

    move(viewport, 40, 20);
    const points = viewport.overlayShapes.get('sketch-tool')?.[0]?.points ?? [];
    // A quarter turn of 64 segments per turn: 16 segments as pairs.
    expect(points).toHaveLength(32);
    for (const [x = NaN, y = NaN] of points) expect(Math.hypot(x - 30, y - 20)).toBeCloseTo(10, 9);
    expect(inferenceOf(session)).toEqual({ anchor: [40, 20, 0], kinds: ['tangent'] });

    move(viewport, 108, 108);
    expect(inferenceOf(session)?.kinds).toEqual(['pointOnCurve', 'tangent']);

    move(viewport, 50, 10);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
    expect(inferenceOf(session)).toBeNull();
  });
});
