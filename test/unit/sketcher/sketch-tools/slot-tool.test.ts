import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Vec2 } from '@/core';
import { ORIGIN_PLANE_IDS, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, isPattern, parseSketchData } from '@/sketch';
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

// The slot tools of M31 (spec 12, "Nové kreslicí nástroje (M31)", "Nástroje"): sketch.slot,
// sketch.slotOverall and sketch.slotArc. An open new sketch on the plane XY with the tools of the
// sketcher, the FakeSolver and the FakeViewport (in its default top view px = the local XY of the
// plane, 1 px = 1 mm). The tools snap through the snapper, so the fake needs no pick.

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

/** The coordinates of the point `id` of the session. */
function xyOf(s: SketchSession, id: string): Vec2 | undefined {
  const p = entitiesOf(s).find((e) => e.id === id);
  return p?.kind === 'point' ? [p.x, p.y] : undefined;
}

/** The entities of the session that were not in `before`. */
function newEntities(s: SketchSession, before?: SketchData): readonly SketchEntity[] {
  const old = new Set(before?.entities.map((e) => e.id) ?? []);
  return entitiesOf(s).filter((e) => !old.has(e.id));
}

/** The new curves of the session as plain values: their points as coordinates. */
function curvesAt(s: SketchSession, before?: SketchData): readonly Record<string, unknown>[] {
  const at = (id: string): Vec2 | undefined => xyOf(s, id);
  return newEntities(s, before).flatMap((e): Record<string, unknown>[] => {
    switch (e.kind) {
      case 'line':
        return [{ kind: 'line', p1: at(e.p1), p2: at(e.p2), construction: e.construction }];
      case 'arc':
        return [{ kind: 'arc', center: at(e.center), start: at(e.start), end: at(e.end) }];
      default:
        return [];
    }
  });
}

const kindsOf = (s: SketchSession): readonly string[] => constraintsOf(s).map((c) => c.kind);

/** The number of points of the preview (pairs of the overlay 'sketch-tool'). */
function previewPoints(viewport: FakeViewport): number {
  const [shape] = viewport.overlayShapes.get('sketch-tool') ?? [];
  return shape?.points.length ?? 0;
}

/** A lone point m (10, 10). */
const POINT = data([{ kind: 'point', id: 'm', x: 10, y: 10 }]);

/** The straight slot of the centres (10, 10), (50, 10) and the radius 10. */
const STRAIGHT_CURVES = [
  { kind: 'line', p1: [10, 20], p2: [50, 20], construction: undefined },
  { kind: 'line', p1: [50, 0], p2: [10, 0], construction: undefined },
  { kind: 'arc', center: [50, 10], start: [50, 0], end: [50, 20] },
  { kind: 'arc', center: [10, 10], start: [10, 20], end: [10, 0] },
];

const TANGENTS_AND_EQUAL = ['tangent', 'tangent', 'tangent', 'tangent', 'equal'];

describe('the centre slot tool', () => {
  it('two centres and a width make 2 lines, 2 arcs and the axis, with a horizontal axis', async () => {
    const { viewport, session, manager } = await drawing('sketch.slot');

    await clicks(viewport, [
      [10, 10],
      [50, 10],
      [30, 20],
    ]);

    expect(curvesAt(session)).toEqual([
      ...STRAIGHT_CURVES,
      { kind: 'line', p1: [10, 10], p2: [50, 10], construction: true },
    ]);
    expect(newEntities(session).filter((e) => e.kind === 'point')).toHaveLength(6);
    expect(kindsOf(session)).toEqual([...TANGENTS_AND_EQUAL, 'horizontal']);
    const axis = newEntities(session).find((e) => e.kind === 'line' && e.construction === true);
    expect(constraintsOf(session).at(-1)).toMatchObject({ kind: 'horizontal', line: axis?.id });
    expect(manager.active.get()).toBe('sketch.slot');
  });

  it('the shape constraints are required: a conflict drops only the axis', async () => {
    const { viewport, session, solver } = await drawing('sketch.slot');
    solver.next({ status: 'conflict', entities: null, conflicting: [] });

    await clicks(viewport, [
      [10, 10],
      [50, 10],
      [30, 20],
    ]);

    expect(kindsOf(session)).toEqual(TANGENTS_AND_EQUAL);
  });

  it('a vertical axis gets vertical; an oblique one no axis', async () => {
    const vertical = await drawing('sketch.slot');
    await clicks(vertical.viewport, [
      [10, 10],
      [10, 50],
      [20, 30],
    ]);
    expect(kindsOf(vertical.session)).toEqual([...TANGENTS_AND_EQUAL, 'vertical']);

    const oblique = await drawing('sketch.slot');
    await clicks(oblique.viewport, [
      [10, 10],
      [50, 30],
      [20, 30],
    ]);
    expect(kindsOf(oblique.session)).toEqual(TANGENTS_AND_EQUAL);
  });

  it('with Ctrl/Cmd the axis gets no horizontal', async () => {
    const { viewport, session } = await drawing('sketch.slot');

    await click(viewport, [10, 10], { mod: true });
    await click(viewport, [50, 10], { mod: true });
    await click(viewport, [30, 20], { mod: true });

    expect(kindsOf(session)).toEqual(TANGENTS_AND_EQUAL);
  });

  it('a centre on an existing point uses its id; the alignment with it becomes the axis', async () => {
    const { viewport, session } = await drawing('sketch.slot', POINT);

    await clicks(viewport, [
      [11, 10],
      [50, 10],
      [30, 20],
    ]);

    const arcs = newEntities(session, POINT).filter((e) => e.kind === 'arc');
    expect(arcs.map((a) => a.center)).toContain('m');
    expect(curvesAt(session, POINT).slice(0, 4)).toEqual(STRAIGHT_CURVES);
    expect(kindsOf(session)).toEqual([...TANGENTS_AND_EQUAL, 'horizontal']);
  });

  it('a short axis aligned with an existing first centre gets the axis of the alignment', async () => {
    const { viewport, session } = await drawing('sketch.slot', POINT);

    // The cursor is 4° off the horizontal of m (more than the 3° of inferLine), within the
    // tolerance of its alignment and just outside the snap onto m itself.
    await clicks(viewport, [
      [10, 10],
      [17, 10.5],
      [20, 20],
    ]);

    const axis = newEntities(session, POINT).find(
      (e) => e.kind === 'line' && e.construction === true,
    );
    expect(axis?.kind === 'line' ? axis.p1 : undefined).toBe('m');
    expect(xyOf(session, axis?.kind === 'line' ? axis.p2 : '')).toEqual([17, 10]);
    expect(kindsOf(session)).toEqual([...TANGENTS_AND_EQUAL, 'horizontal']);
    expect(kindsOf(session)).not.toContain('hAlign');
  });

  it('a width on the axis makes nothing and the centres stay', async () => {
    const { viewport, session } = await drawing('sketch.slot');

    await clicks(viewport, [
      [10, 10],
      [50, 10],
      [30, 10],
    ]);
    expect(entitiesOf(session)).toEqual([]);

    await clicks(viewport, [[30, 20]]);
    expect(curvesAt(session).slice(0, 4)).toEqual(STRAIGHT_CURVES);
  });

  it('a second centre on the first makes nothing', async () => {
    const { viewport, session } = await drawing('sketch.slot');

    await clicks(viewport, [
      [10, 10],
      [10, 10],
      [30, 20],
    ]);
    expect(entitiesOf(session)).toEqual([]);
  });

  it('Escape forgets the centres, with nothing picked it returns to sketch.select', async () => {
    const { viewport, session, manager } = await drawing('sketch.slot');
    await clicks(viewport, [
      [10, 10],
      [50, 10],
    ]);
    move(viewport, [30, 20]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.slot');
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);

    await clicks(viewport, [[30, 20]]);
    expect(entitiesOf(session)).toEqual([]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.slot');
    escape(viewport);
    expect(manager.active.get()).toBe('sketch.select');
  });

  it('previews the axis, then the outline; a degenerate one is not drawn', async () => {
    const { viewport, session } = await drawing('sketch.slot');
    await clicks(viewport, [[10, 10]]);

    move(viewport, [50, 10]);
    expect(viewport.overlayShapes.get('sketch-tool')).toEqual([
      {
        kind: 'lines',
        points: [
          [10, 10, 0],
          [50, 10, 0],
        ],
        style: 'preview',
      },
    ]);
    expect(session.state.get().inference).toEqual({ anchor: [50, 10, 0], kinds: ['horizontal'] });

    await clicks(viewport, [[50, 10]]);
    move(viewport, [30, 20]);
    // Two half circles of 32 segments and the two lines between them, as pairs.
    expect(previewPoints(viewport)).toBe(2 * (2 * 32 + 2));
    const [shape] = viewport.overlayShapes.get('sketch-tool') ?? [];
    expect(shape?.points[0]).toEqual([10, 0, 0]);
    expect(shape?.style).toBe('preview');

    move(viewport, [30, 10]);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
  });

  it('previews no axis with Ctrl/Cmd', async () => {
    const { viewport, session } = await drawing('sketch.slot');
    await clicks(viewport, [[10, 10]]);

    move(viewport, [50, 10], { mod: true });
    expect(session.state.get().inference).toBeNull();
  });
});

describe('the overall slot tool', () => {
  it('two ends and a width make the slot with new centres, the axis between the ends', async () => {
    const { viewport, session, manager } = await drawing('sketch.slotOverall');

    await clicks(viewport, [
      [0, 10],
      [60, 10],
      [30, 20],
    ]);

    expect(curvesAt(session)).toEqual([
      ...STRAIGHT_CURVES,
      { kind: 'line', p1: [0, 10], p2: [60, 10], construction: true },
    ]);
    expect(newEntities(session).filter((e) => e.kind === 'point')).toHaveLength(8);
    expect(kindsOf(session)).toEqual([
      ...TANGENTS_AND_EQUAL,
      'pointOnCurve',
      'pointOnCurve',
      'pointOnCurve',
      'pointOnCurve',
      'horizontal',
    ]);
    expect(manager.active.get()).toBe('sketch.slotOverall');
  });

  it('the shape constraints are required: a conflict drops only the axis', async () => {
    const { viewport, session, solver } = await drawing('sketch.slotOverall');
    solver.next({ status: 'conflict', entities: null, conflicting: [] });

    await clicks(viewport, [
      [0, 10],
      [60, 10],
      [30, 20],
    ]);

    expect(kindsOf(session)).not.toContain('horizontal');
    expect(kindsOf(session)).toHaveLength(9);
  });

  it('an end on an existing point uses its id', async () => {
    const { viewport, session } = await drawing('sketch.slotOverall', POINT);

    await clicks(viewport, [
      [11, 10],
      [70, 10],
      [40, 20],
    ]);

    const axis = newEntities(session, POINT).find(
      (e) => e.kind === 'line' && e.construction === true,
    );
    expect(axis).toMatchObject({ p1: 'm' });
  });

  it('a width wider than the length makes nothing and the ends stay; with Ctrl/Cmd no axis', async () => {
    const { viewport, session } = await drawing('sketch.slotOverall');

    await clicks(viewport, [
      [0, 10],
      [60, 10],
      [30, 45],
    ]);
    expect(entitiesOf(session)).toEqual([]);

    await click(viewport, [30, 20], { mod: true });
    expect(kindsOf(session)).toHaveLength(10);
    expect(kindsOf(session)).toContain('horizontal');
  });

  it('with Ctrl/Cmd the axis gets no horizontal', async () => {
    const { viewport, session } = await drawing('sketch.slotOverall');

    await click(viewport, [0, 10], { mod: true });
    await click(viewport, [60, 10], { mod: true });
    await click(viewport, [30, 20], { mod: true });

    expect(kindsOf(session)).toHaveLength(9);
    expect(kindsOf(session)).not.toContain('horizontal');
  });

  it('Escape forgets the ends, a second Escape returns to sketch.select', async () => {
    const { viewport, manager } = await drawing('sketch.slotOverall');
    await clicks(viewport, [[0, 10]]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.slotOverall');
    escape(viewport);
    expect(manager.active.get()).toBe('sketch.select');
  });

  it('previews the outline of the slot inside the ends', async () => {
    const { viewport } = await drawing('sketch.slotOverall');
    await clicks(viewport, [
      [0, 10],
      [60, 10],
    ]);

    move(viewport, [30, 20]);
    const [shape] = viewport.overlayShapes.get('sketch-tool') ?? [];
    expect(shape?.points[0]).toEqual([10, 0, 0]);

    move(viewport, [30, 45]);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
  });
});

/** The arc slot around (100, 100) of the axis radius 40 from (140, 100) to (100, 140), half the width 10. */
const ARC_CLICKS: readonly Vec2[] = [
  [100, 100],
  [140, 100],
  [100, 180],
  [150, 100],
];

const TANGENTS = ['tangent', 'tangent', 'tangent', 'tangent'];

describe('the arc slot tool', () => {
  it('centre, start, end and width make 4 arcs with 4 tangents and no axis', async () => {
    const { viewport, session, manager } = await drawing('sketch.slotArc');

    await clicks(viewport, ARC_CLICKS);

    expect(curvesAt(session)).toEqual([
      { kind: 'arc', center: [100, 100], start: [130, 100], end: [100, 130] },
      { kind: 'arc', center: [100, 100], start: [150, 100], end: [100, 150] },
      { kind: 'arc', center: [140, 100], start: [130, 100], end: [150, 100] },
      { kind: 'arc', center: [100, 140], start: [100, 150], end: [100, 130] },
    ]);
    expect(newEntities(session).filter((e) => e.kind === 'point')).toHaveLength(7);
    expect(kindsOf(session)).toEqual(TANGENTS);
    expect(manager.active.get()).toBe('sketch.slotArc');
  });

  it('the tangents are required: a conflict drops only the alignment of the start', async () => {
    const { viewport, session, solver } = await drawing('sketch.slotArc', POINT);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });

    await clicks(viewport, [
      [11, 10],
      [50, 10],
      [10, 51],
      [60, 10],
    ]);

    expect(kindsOf(session)).toEqual(TANGENTS);
  });

  it('a centre on an existing point uses its id; the end is a new point without inferences', async () => {
    const { viewport, session } = await drawing('sketch.slotArc', POINT);

    await clicks(viewport, [
      [11, 10],
      [50, 10],
      [10, 51],
      [60, 10],
    ]);

    const arcs = newEntities(session, POINT).filter((e) => e.kind === 'arc');
    expect(arcs.slice(0, 2).map((a) => a.center)).toEqual(['m', 'm']);
    // The start (50, 10) aligns with m; the end gets nothing.
    expect(kindsOf(session)).toEqual(['hAlign', ...TANGENTS]);
  });

  it('a degenerate end or width makes nothing and the picked points stay', async () => {
    const { viewport, session } = await drawing('sketch.slotArc');

    await clicks(viewport, [
      [100, 100],
      [140, 100],
      // The end on the start.
      [180, 100],
      [100, 180],
      // A width beyond the centre: half ≥ the axis radius.
      [190, 100],
    ]);
    expect(entitiesOf(session)).toEqual([]);

    await clicks(viewport, [[150, 100]]);
    expect(newEntities(session).filter((e) => e.kind === 'arc')).toHaveLength(4);
  });

  it('Escape forgets the picked points, with nothing picked it returns to sketch.select', async () => {
    const { viewport, session, manager } = await drawing('sketch.slotArc');
    await clicks(viewport, ARC_CLICKS.slice(0, 3));

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.slotArc');
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
    await clicks(viewport, [[150, 100]]);
    expect(entitiesOf(session)).toEqual([]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.slotArc');
    escape(viewport);
    expect(manager.active.get()).toBe('sketch.select');
  });

  it('previews the radius, the arc of the axis, then the outline', async () => {
    const { viewport, session } = await drawing('sketch.slotArc');
    await clicks(viewport, [[100, 100]]);

    move(viewport, [140, 100]);
    expect(previewPoints(viewport)).toBe(2);

    await clicks(viewport, [[140, 100]]);
    move(viewport, [100, 180]);
    // A quarter turn of 16 segments, as pairs; the end has no inferences.
    expect(previewPoints(viewport)).toBe(2 * 16);
    expect(session.state.get().inference).toBeNull();

    await clicks(viewport, [[100, 180]]);
    move(viewport, [150, 100]);
    const [shape] = viewport.overlayShapes.get('sketch-tool') ?? [];
    expect(shape?.points[0]).toEqual([150, 100, 0]);

    move(viewport, [190, 100]);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
  });
});

describe('the slot tools in the construction mode (M31)', () => {
  it('draw every curve of the slot as construction', async () => {
    const { viewport, session } = await drawing('sketch.slot');
    session.setConstructionMode(true);

    await clicks(viewport, [
      [10, 10],
      [50, 10],
      [30, 20],
    ]);

    const curves = newEntities(session).flatMap((e) =>
      e.kind === 'point' || isPattern(e) ? [] : [e],
    );
    expect(curves).toHaveLength(5);
    expect(curves.every((c) => c.construction === true)).toBe(true);
  });
});

// The numeric input of the slot tools (spec 12, "Číselný vstup (M32)", the table "Pole a kóty
// podle nástrojů"): the first point x, y; a straight slot the second point of the axis length,
// angle and the width; an arc slot the start radius, angle, the end sweep and the width. Locked
// values become required dimensions of the slot, written with it.

const DEG = Math.PI / 180;

/** Types the keys into the view one by one. */
function type(viewport: FakeViewport, keys: readonly string[]): void {
  for (const key of keys) viewport.emitKey({ key, mods: NO_MODS, inTextField: false });
}

const chars = (text: string): readonly string[] => Array.from(text);

/** The fields of the numeric input as [id, text]. */
const fieldsOf = (s: SketchSession): readonly (readonly [string, string])[] =>
  s.state.get().numericInput?.fields.map((f) => [f.id, f.text] as const) ?? [];

const anchorOf = (s: SketchSession) => s.state.get().numericInput?.anchor;

/** The constraints of the session from the index `from`, without their ids. */
const dimensionsOf = (s: SketchSession, from: number) =>
  constraintsOf(s)
    .slice(from)
    .map((c) => ({ ...c, id: undefined }));

/** A matcher of a point within 1e-9 of `p`. */
const near = (p: Vec2): readonly unknown[] => [expect.closeTo(p[0], 9), expect.closeTo(p[1], 9)];

const arcsOf = (s: SketchSession) => entitiesOf(s).flatMap((e) => (e.kind === 'arc' ? [e] : []));

/** The construction axis of a straight slot. */
function axisOf(s: SketchSession) {
  const axis = entitiesOf(s).find((e) => e.kind === 'line' && e.construction === true);
  if (axis?.kind !== 'line') throw new Error('no axis');
  return axis;
}

/** The arc of a straight slot around its first centre (arc1; the curves are left, right, arc2, arc1). */
const arc1Of = (s: SketchSession) => arcsOf(s)[1];

describe('the fields of the slot tools (M32)', () => {
  it('a straight slot: x, y, then length, angle, then width with the measured values', async () => {
    const { viewport, session } = await drawing('sketch.slot');
    move(viewport, [10, 20]);
    expect(fieldsOf(session)).toEqual([
      ['x', '10.00'],
      ['y', '20.00'],
    ]);

    await clicks(viewport, [[10, 10]]);
    move(viewport, [10, 40]);
    expect(fieldsOf(session)).toEqual([
      ['length', '30.00'],
      ['angle', '90.00'],
    ]);

    await clicks(viewport, [[50, 10]]);
    move(viewport, [30, 2]);
    expect(fieldsOf(session)).toEqual([['width', '16.00']]);
  });

  it('an overall slot has the fields of a straight one', async () => {
    const { viewport, session } = await drawing('sketch.slotOverall');
    await clicks(viewport, [[0, 10]]);
    move(viewport, [60, 10]);
    expect(fieldsOf(session).map(([id]) => id)).toEqual(['length', 'angle']);

    await clicks(viewport, [[60, 10]]);
    move(viewport, [30, 20]);
    expect(fieldsOf(session)).toEqual([['width', '20.00']]);
  });

  it('an arc slot: x, y, then radius, angle, then sweep, then width', async () => {
    const { viewport, session } = await drawing('sketch.slotArc');
    move(viewport, [100, 100]);
    expect(fieldsOf(session).map(([id]) => id)).toEqual(['x', 'y']);

    await clicks(viewport, [[100, 100]]);
    move(viewport, [100, 140]);
    expect(fieldsOf(session)).toEqual([
      ['radius', '40.00'],
      ['angle', '90.00'],
    ]);

    await clicks(viewport, [[140, 100]]);
    move(viewport, [100, 180]);
    expect(fieldsOf(session)).toEqual([['sweep', '90.00']]);

    await clicks(viewport, [[100, 180]]);
    move(viewport, [150, 100]);
    expect(fieldsOf(session)).toEqual([['width', '20.00']]);
  });
});

describe('the numeric input of the straight slots (M32)', () => {
  it('a centre slot of length 40 and width 10 only from the keyboard', async () => {
    const { viewport, session } = await drawing('sketch.slot');
    move(viewport, [3, 4]);
    type(viewport, [...chars('10'), 'Tab', ...chars('10'), 'Enter']);
    move(viewport, [60, 13]);
    type(viewport, [...chars('40'), 'Tab', '0', 'Enter']);
    move(viewport, [30, 30]);
    type(viewport, [...chars('10'), 'Enter']);
    await settle();

    expect(curvesAt(session)).toEqual([
      { kind: 'line', p1: [10, 15], p2: [50, 15], construction: undefined },
      { kind: 'line', p1: [50, 5], p2: [10, 5], construction: undefined },
      { kind: 'arc', center: [50, 10], start: [50, 5], end: [50, 15] },
      { kind: 'arc', center: [10, 10], start: [10, 15], end: [10, 5] },
      { kind: 'line', p1: [10, 10], p2: [50, 10], construction: true },
    ]);
    const axis = axisOf(session);
    expect(arc1Of(session)?.center).toBe(axis.p1);
    expect(
      constraintsOf(session)
        .slice(0, 5)
        .map((c) => c.kind),
    ).toEqual(TANGENTS_AND_EQUAL);
    expect(dimensionsOf(session, 5)).toEqual([
      { kind: 'distance', a: axis.p1, b: axis.p2, value: 40 },
      { kind: 'horizontal', line: axis.id },
      { kind: 'diameter', curve: arc1Of(session)?.id, value: 10 },
    ]);
  });

  it('the width is constrained to the side of the cursor at half the width from the axis', async () => {
    const { viewport, session } = await drawing('sketch.slot');
    await clicks(viewport, [
      [10, 10],
      [50, 10],
    ]);
    type(viewport, [...chars('10'), 'Tab']);

    move(viewport, [30, 30]);
    expect(anchorOf(session)).toEqual([30, 15, 0]);
    move(viewport, [20, -20]);
    expect(anchorOf(session)).toEqual([20, 5, 0]);
  });

  it('a typed width is only a preview: a click takes the cursor', async () => {
    const { viewport, session } = await drawing('sketch.slot');
    await clicks(viewport, [
      [10, 10],
      [50, 10],
    ]);
    move(viewport, [30, 30]);
    type(viewport, [...chars('10')]);
    // The preview of the typed width: the outline from r1 = (10, 5).
    const [shape] = viewport.overlayShapes.get('sketch-tool') ?? [];
    expect(shape?.points[0]).toEqual([10, 5, 0]);

    await clicks(viewport, [[30, 30]]);
    // The radius from the cursor: 20; no dimension.
    expect(curvesAt(session)[2]).toMatchObject({ start: [50, -10], end: [50, 30] });
    expect(kindsOf(session)).toEqual([...TANGENTS_AND_EQUAL, 'horizontal']);
  });

  it('a locked width with a click is a required diameter of the arc around c1', async () => {
    const { viewport, session } = await drawing('sketch.slot');
    await clicks(viewport, [
      [10, 10],
      [50, 10],
    ]);
    type(viewport, [...chars('10'), 'Tab']);
    await clicks(viewport, [[30, 30]]);

    expect(curvesAt(session)[2]).toMatchObject({ start: [50, 5], end: [50, 15] });
    expect(dimensionsOf(session, 5)).toEqual([
      { kind: 'diameter', curve: arc1Of(session)?.id, value: 10 },
      { kind: 'horizontal', line: axisOf(session).id },
    ]);
  });

  it('a locked length with the direction from the mouse keeps the automatic axis', async () => {
    const { viewport, session } = await drawing('sketch.slot');
    await clicks(viewport, [[10, 10]]);
    type(viewport, [...chars('40'), 'Tab']);
    await clicks(viewport, [
      [80, 11],
      [30, 20],
    ]);

    const axis = axisOf(session);
    const d = Math.hypot(70, 1);
    expect(xyOf(session, axis.p2)).toEqual(near([10 + (40 * 70) / d, 10 + 40 / d]));
    expect(dimensionsOf(session, 5)).toEqual([
      { kind: 'distance', a: axis.p1, b: axis.p2, value: 40 },
      { kind: 'horizontal', line: axis.id },
    ]);
  });

  it('the dimensions are required: a conflict drops only the automatic axis', async () => {
    const { viewport, session, solver } = await drawing('sketch.slot');
    await clicks(viewport, [[10, 10]]);
    type(viewport, [...chars('40'), 'Tab']);
    await clicks(viewport, [[80, 11]]);
    type(viewport, [...chars('10'), 'Tab']);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });
    await clicks(viewport, [[30, 20]]);

    expect(kindsOf(session)).toEqual([...TANGENTS_AND_EQUAL, 'distance', 'diameter']);
  });

  it('an angle of 90° is a required vertical axis', async () => {
    const { viewport, session, solver } = await drawing('sketch.slot', POINT);
    // The first centre aligns with m (automatic hAlign), which the conflict drops.
    await clicks(viewport, [[30, 11]]);
    move(viewport, [60, 30]);
    type(viewport, ['Tab', ...chars('90')]);
    expect(session.state.get().inference?.kinds).toEqual(['vertical']);
    type(viewport, ['Enter']);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });
    await clicks(viewport, [[20, 30]]);

    const axis = axisOf(session);
    expect(xyOf(session, axis.p2)).toEqual(near([30, 30]));
    expect(dimensionsOf(session, 5)).toEqual([{ kind: 'vertical', line: axis.id }]);
  });

  it('an angle off the axes has no dimension and replaces the automatic axis', async () => {
    const { viewport, session } = await drawing('sketch.slot');
    await clicks(viewport, [[10, 10]]);
    // The mouse would infer horizontal; the locked 2° replaces it.
    move(viewport, [40, 11]);
    type(viewport, [...chars('30'), 'Tab', '2', 'Enter']);
    await clicks(viewport, [[20, 30]]);

    const axis = axisOf(session);
    expect(xyOf(session, axis.p2)).toEqual(
      near([10 + 30 * Math.cos(2 * DEG), 10 + 30 * Math.sin(2 * DEG)]),
    );
    expect(dimensionsOf(session, 5)).toEqual([
      { kind: 'distance', a: axis.p1, b: axis.p2, value: 30 },
    ]);
  });

  it('an overall slot: the length is the distance of the ends', async () => {
    const { viewport, session } = await drawing('sketch.slotOverall');
    await clicks(viewport, [[0, 10]]);
    move(viewport, [70, 10]);
    type(viewport, [...chars('60'), 'Tab', '0', 'Enter']);
    move(viewport, [30, 30]);
    type(viewport, [...chars('20'), 'Enter']);
    await settle();

    expect(curvesAt(session)).toEqual([
      ...STRAIGHT_CURVES,
      { kind: 'line', p1: [0, 10], p2: [60, 10], construction: true },
    ]);
    const axis = axisOf(session);
    expect(xyOf(session, arc1Of(session)?.center ?? '')).toEqual([10, 10]);
    expect(dimensionsOf(session, 9)).toEqual([
      { kind: 'distance', a: axis.p1, b: axis.p2, value: 60 },
      { kind: 'horizontal', line: axis.id },
      { kind: 'diameter', curve: arc1Of(session)?.id, value: 20 },
    ]);
  });
});

describe('the numeric input of the arc slot (M32)', () => {
  it('radius 40 from 0°, sweep 90° and width 20 only from the keyboard', async () => {
    const { viewport, session } = await drawing('sketch.slotArc');
    move(viewport, [90, 90]);
    type(viewport, [...chars('100'), 'Tab', ...chars('100'), 'Enter']);
    move(viewport, [150, 120]);
    type(viewport, [...chars('40'), 'Tab', '0', 'Enter']);
    move(viewport, [90, 170]);
    type(viewport, [...chars('90'), 'Enter']);
    move(viewport, [160, 100]);
    type(viewport, [...chars('20'), 'Enter']);
    await settle();

    expect(curvesAt(session)).toEqual([
      { kind: 'arc', center: [100, 100], start: [130, 100], end: near([100, 130]) },
      { kind: 'arc', center: [100, 100], start: [150, 100], end: near([100, 150]) },
      { kind: 'arc', center: [140, 100], start: [130, 100], end: [150, 100] },
      { kind: 'arc', center: near([100, 140]), start: near([100, 150]), end: near([100, 130]) },
    ]);
    const [inner, , startArc] = arcsOf(session);
    expect(
      constraintsOf(session)
        .slice(0, 4)
        .map((c) => c.kind),
    ).toEqual(TANGENTS);
    expect(dimensionsOf(session, 4)).toEqual([
      { kind: 'distance', a: inner?.center, b: startArc?.center, value: 40 },
      { kind: 'diameter', curve: startArc?.id, value: 20 },
    ]);
  });

  it('a locked radius with the direction from the mouse', async () => {
    const { viewport, session } = await drawing('sketch.slotArc');
    await clicks(viewport, [[100, 100]]);
    type(viewport, [...chars('40'), 'Tab']);
    move(viewport, [100, 300]);
    expect(anchorOf(session)).toEqual([100, 140, 0]);
  });

  it('the sweep places the end on the circle; a sweep ≤ 0 is degenerate', async () => {
    const { viewport, session } = await drawing('sketch.slotArc');
    await clicks(viewport, [
      [100, 100],
      [140, 100],
    ]);
    move(viewport, [300, 300]);
    type(viewport, ['0', 'Enter']);
    // Nothing taken: still the sweep.
    expect(fieldsOf(session).map(([id]) => id)).toEqual(['sweep']);

    type(viewport, [...chars('180'), 'Tab']);
    expect(anchorOf(session)).toEqual([expect.closeTo(60, 9), expect.closeTo(100, 9), 0]);
    type(viewport, ['Enter']);
    expect(fieldsOf(session).map(([id]) => id)).toEqual(['width']);
  });

  it('the width is constrained on the side of the cursor; the sweep has no dimension', async () => {
    const { viewport, session } = await drawing('sketch.slotArc');
    await clicks(viewport, ARC_CLICKS.slice(0, 3));
    type(viewport, [...chars('20'), 'Tab']);

    move(viewport, [200, 100]);
    expect(anchorOf(session)).toEqual([150, 100, 0]);
    move(viewport, [100, 110]);
    expect(anchorOf(session)).toEqual([100, 130, 0]);

    await clicks(viewport, [[100, 110]]);
    expect(kindsOf(session)).toEqual([...TANGENTS, 'diameter']);
  });
});
