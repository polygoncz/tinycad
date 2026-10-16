import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Vec2 } from '@/core';
import { ORIGIN_PLANE_IDS, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, parseSketchData } from '@/sketch';
import type { SketchData, SketchEntity } from '@/sketch';
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

// The 3-point arc tool (spec 12, "Oblouky a kružnice (M27)"): start, end, point on the arc.

/** A lone point m at (20, 0) and the horizontal line l from (0, 40) to (100, 40). */
const SKETCH = data([
  { kind: 'point', id: 'm', x: 20, y: 0 },
  { kind: 'point', id: 'l1', x: 0, y: 40 },
  { kind: 'point', id: 'l2', x: 100, y: 40 },
  { kind: 'line', id: 'l', p1: 'l1', p2: 'l2' },
]);
const BEFORE = SKETCH.entities.length;

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

describe('the 3-point arc tool', () => {
  it('start, end and a point below make a counter-clockwise arc from start to end', async () => {
    const { manager, viewport, session } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arc3p');

    await clicks(viewport, [
      [10, 10],
      [30, 10],
      [20, 7],
    ]);

    const added = addedOf(session, BEFORE);
    expect(added.map((e) => e.kind)).toEqual(['point', 'point', 'point', 'arc']);
    const [arc] = arcsOf(session);
    if (arc === undefined) throw new Error('no arc');
    expect(xyOf(session, arc.start)).toEqual([10, 10]);
    expect(xyOf(session, arc.end)).toEqual([30, 10]);
    const center = xyOf(session, arc.center);
    // Through (20, 7): the circumcentre lies on x = 20, as far from (20, 7) as from (10, 10).
    expect(center[0]).toBeCloseTo(20, 9);
    expect(Math.hypot(center[0] - 20, center[1] - 7)).toBeCloseTo(
      Math.hypot(center[0] - 10, center[1] - 10),
      9,
    );
    // The point on the arc is a place only: no entity, no constraint.
    expect(constraintsOf(session)).toEqual([]);
    expect(manager.active.get()).toBe('sketch.arc3p');
  });

  it('a clockwise arc (point above) swaps start and end in the data', async () => {
    const { manager, viewport, session } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arc3p');

    await clicks(viewport, [
      [10, 10],
      [30, 10],
      [20, 20],
    ]);

    const [arc] = arcsOf(session);
    if (arc === undefined) throw new Error('no arc');
    expect(xyOf(session, arc.start)).toEqual([30, 10]);
    expect(xyOf(session, arc.end)).toEqual([10, 10]);
    expect(xyOf(session, arc.center)).toEqual([20, 10]);
  });

  it('a point on the arc snapped onto an existing point adds pointOnCurve', async () => {
    const { manager, viewport, session } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arc3p');

    await clicks(viewport, [
      [10, 10],
      [30, 10],
      [21, 1],
    ]);

    const [arc] = arcsOf(session);
    expect(constraintsOf(session)).toEqual([{ kind: 'pointOnCurve', point: 'm', curve: arc?.id }]);
  });

  it('the start and the end get the inferred constraints of the snapper', async () => {
    const { manager, viewport, session } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arc3p');

    await clicks(viewport, [
      [30, 41],
      [70, 41],
      [50, 20],
    ]);

    const [arc] = arcsOf(session);
    if (arc === undefined) throw new Error('no arc');
    expect(constraintsOf(session)).toEqual([
      { kind: 'pointOnCurve', point: arc.start, curve: 'l' },
      { kind: 'pointOnCurve', point: arc.end, curve: 'l' },
    ]);
  });

  it('pointOnCurve of the point on the arc is required, the inferred ones are not', async () => {
    const { manager, viewport, session, solver } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arc3p');
    // The start on the line gets pointOnCurve; the solver finds a conflict in everything.
    solver.next({ status: 'conflict', entities: null, conflicting: [] });

    await clicks(viewport, [
      [30, 41],
      [10, 10],
      [21, 1],
    ]);

    const [arc] = arcsOf(session);
    expect(constraintsOf(session)).toEqual([{ kind: 'pointOnCurve', point: 'm', curve: arc?.id }]);
  });

  it('a radius within 2 % of the last circle or arc gets equal; Ctrl/Cmd keeps only the required', async () => {
    const circle = data([
      ...SKETCH.entities,
      { kind: 'point', id: 'c', x: 200, y: 200 },
      { kind: 'circle', id: 'k', center: 'c', radius: 10 },
    ]);
    const plain = await sketching({ sketch: circle });
    plain.manager.activate('sketch.arc3p');
    await clicks(plain.viewport, [
      [10, 10],
      [30, 10],
      [20, 20],
    ]);
    const [arc] = arcsOf(plain.session);
    expect(constraintsOf(plain.session)).toEqual([{ kind: 'equal', a: arc?.id, b: 'k' }]);

    const ctrl = await sketching({ sketch: circle });
    ctrl.manager.activate('sketch.arc3p');
    await clicks(
      ctrl.viewport,
      [
        [30, 41],
        [10, 10],
        [21, 1],
      ],
      { mod: true },
    );
    const [arc2] = arcsOf(ctrl.session);
    expect(constraintsOf(ctrl.session)).toEqual([
      { kind: 'pointOnCurve', point: 'm', curve: arc2?.id },
    ]);
  });

  it('a point on the line start–end makes nothing and the tool keeps its points', async () => {
    const { manager, viewport, session } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arc3p');

    await clicks(viewport, [
      [10, 10],
      [30, 10],
      [50, 10],
    ]);
    expect(addedOf(session, BEFORE)).toEqual([]);

    await clicks(viewport, [[20, 20]]);
    expect(arcsOf(session)).toHaveLength(1);
  });

  it('an end on the start or a point on an end makes nothing', async () => {
    const { manager, viewport, session } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arc3p');

    await clicks(viewport, [
      [20, 0],
      [20, 0],
      [40, 0],
      [20, 0],
    ]);

    expect(addedOf(session, BEFORE)).toEqual([]);
  });

  it('Escape forgets the picked points, a second Escape ends the tool', async () => {
    const { manager, viewport, session } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arc3p');
    await clicks(viewport, [
      [10, 10],
      [30, 10],
    ]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.arc3p');
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
    await clicks(viewport, [[20, 20]]);
    expect(addedOf(session, BEFORE)).toEqual([]);

    escape(viewport);
    escape(viewport);
    expect(manager.active.get()).toBe('sketch.select');
  });

  it('previews the chord, then the arc; a degenerate arc is not drawn', async () => {
    const { manager, viewport } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arc3p');
    await clicks(viewport, [[10, 10]]);

    move(viewport, 30, 10);
    expect(viewport.overlayShapes.get('sketch-tool')?.[0]?.points).toEqual([
      [10, 10, 0],
      [30, 10, 0],
    ]);

    await clicks(viewport, [[30, 10]]);
    move(viewport, 20, 20);
    const points = viewport.overlayShapes.get('sketch-tool')?.[0]?.points ?? [];
    // Half a turn of 64 segments per turn: 32 segments as pairs.
    expect(points).toHaveLength(64);
    for (const [x = NaN, y = NaN] of points) expect(Math.hypot(x - 20, y - 10)).toBeCloseTo(10, 9);

    move(viewport, 50, 10);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
  });

  it('previews pointOnCurve of the point on the arc and the inferences of start and end', async () => {
    const { manager, viewport, session } = await sketching({ sketch: SKETCH });
    manager.activate('sketch.arc3p');

    move(viewport, 30, 41);
    expect(inferenceOf(session)).toEqual({ anchor: [30, 40, 0], kinds: ['pointOnCurve'] });

    await clicks(viewport, [
      [10, 10],
      [30, 10],
    ]);
    move(viewport, 21, 1);
    expect(inferenceOf(session)).toEqual({ anchor: [20, 0, 0], kinds: ['pointOnCurve'] });

    move(viewport, 50, 10);
    expect(inferenceOf(session)).toBeNull();
  });
});
