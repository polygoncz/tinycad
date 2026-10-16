import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Plane, Vec2, Vec3 } from '@/core';
import {
  ORIGIN_PLANES,
  ORIGIN_PLANE_IDS,
  createFeatureSchemaRegistry,
  validateAgainstSchema,
} from '@/document';
import type { BodyId, FeatureId, FeatureSchema, ParamSchema, PlaneRef, TopoRef } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, parseSketchData } from '@/sketch';
import type { SketchConstraint, SketchData, SketchEntity } from '@/sketch';
import { createFakeSketchGeometry, createFakeSolver } from '@/sketch/testing';
import {
  createFeatureEditor,
  createSelectionModel,
  createToolManager,
  createToolRegistry,
  SELECT_TOOL,
} from '@/interaction';
import { ORIGIN_POINT_ID } from '@/sketcher/sketch-drawing';
import { createSketchEditor } from '@/sketcher/sketch-editor';
import { EDIT_SKETCH_DRAWING_ID } from '@/sketcher/sketch-session';
import type { SketchSession } from '@/sketcher/sketch-session';
import { createSketchTools } from '@/sketcher/sketch-tools';
import { FakeRegenStatus, FakeViewport, aTopoNames } from '@/interaction/testing';
import { snapAt } from '@/sketcher/sketch-tools/snap';
import type {
  KeyMods,
  PickResult,
  SketchDrawing,
  ToolContext,
  ViewPointerEvent,
} from '@/interaction';

// The schema of the sketch feature as in spec 12 (the plugin is a separate task, Ú10).
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

const BOX_PARAMS: ParamSchema = {
  width: { kind: 'length', label: 'box.width', default: 10 },
};
const BOX_SCHEMA: FeatureSchema = {
  type: 'box',
  version: 1,
  label: 'box.label',
  params: BOX_PARAMS,
  defaults: () => ({ width: 10 }),
  validate: (params) => validateAgainstSchema(BOX_PARAMS, params),
};

const [XY, XZ, YZ] = ORIGIN_PLANES.map((p) => p.plane) as [Plane, Plane, Plane]; // a fixed table of three

/** The top face of a box [0, 10]³ as the regeneration would resolve it (M14; app: planeOfRef). */
const TOP: Plane = Object.freeze<Plane>({ origin: [0, 0, 10], xDir: [1, 0, 0], normal: [0, 0, 1] });
// Test ids are trusted.
const BODY = 'b1/body' as BodyId;

/**
 * A fake of app's resolvePlane: the origin planes and the planar faces 'b1/face:top' and
 * 'b1/face:front' of BODY; 'b1/face:side' stands for a face that is not planar (M14).
 */
function resolvePlane(ref: PlaneRef | TopoRef): Plane | undefined {
  if (ref.kind === 'plane') return ORIGIN_PLANES.find((p) => p.id === ref.plane)?.plane;
  if (ref.body !== BODY) return undefined;
  if (ref.name === 'b1/face:top') return TOP;
  if (ref.name === 'b1/face:front') return XZ;
  return undefined;
}

const NO_MODS: KeyMods = { shift: false, alt: false, mod: false };

/** Valid sketch data from plain values (parse brands the ids). */
function data(entities: readonly unknown[], constraints: readonly unknown[] = []): SketchData {
  const parsed = parseSketchData(entities, constraints);
  if (!parsed.ok) throw new Error(`invalid test data ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

/** Pick radius in px of the fake: points first, then curves (like render, spec 12). */
const PICK_RADIUS = 1;

/**
 * A pick like render's over the recorded drawings: in the default top view px = local XY of the
 * plane XY. Points have priority over curves; arcs count as full circles.
 */
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
    const segments = c.points.slice(1).map((to, i) => ({ from: c.points[i] ?? to, to }));
    return Math.min(Infinity, ...segments.map((s) => segmentDistance(s.from, s.to, x, y)));
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

/** gridStep: the step of the grid the editor reads (default: the editor's own, 1). */
function setup(opts: { gridStep?: () => number } = {}) {
  const schemas = createFeatureSchemaRegistry();
  schemas.register(SKETCH_SCHEMA);
  schemas.register(BOX_SCHEMA);
  const ops = anOpsSession({ schemas });
  const editor = createFeatureEditor({
    doc: ops.doc,
    ops: ops.dispatcher,
    schemas,
    ids: createSequentialIdGenerator('f'),
    translate: (key) => key,
  });
  const solver = createFakeSolver();
  const viewport = new FakeViewport();
  viewport.setPick((x, y) => pickDrawings(viewport, x, y));
  const ids = createSequentialIdGenerator('t');
  const sketches = createSketchEditor({
    features: editor,
    solver,
    geometry: createFakeSketchGeometry(),
    viewport,
    resolvePlane,
    planeOfSketch: () => undefined,
    ...(opts.gridStep === undefined ? {} : { gridStep: opts.gridStep }),
  });
  const regen = new FakeRegenStatus();
  // A box with named faces 0 (front), 2 (side) and 5 (top); face 1 has no name (M14).
  regen.publish(new Map(), [
    {
      body: BODY,
      feature: 'b1' as FeatureId,
      names: aTopoNames({
        faces: { 'b1/face:front': [0], 'b1/face:side': [2], 'b1/face:top': [5] },
      }),
    },
  ]);
  const selection = createSelectionModel({ regen });
  const registry = createToolRegistry();
  registry.register(SELECT_TOOL);
  const tools = createSketchTools({ sketches });
  for (const tool of tools) registry.register(tool);
  const ctx: Omit<ToolContext, 'finish'> = {
    viewport,
    selection,
    doc: ops.doc,
    ids,
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
  return { ...ops, editor, solver, viewport, sketches, selection, manager, tools, ctx };
}

/** Lets the solver answers (microtasks) and the queue settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A setup with an open new sketch (with `sketch` written into it) after the first solve. */
async function sketching(opts: { sketch?: SketchData; gridStep?: () => number } = {}) {
  const ctx = setup(opts.gridStep === undefined ? {} : { gridStep: opts.gridStep });
  ctx.manager.activate('sketch');
  const session = ctx.sketches.current.get();
  if (session === null) throw new Error('no session');
  if (opts.sketch !== undefined) await session.addGeometry(opts.sketch);
  await settle();
  return { ...ctx, session };
}

function pointer(
  type: ViewPointerEvent['type'],
  x: number,
  y: number,
  mods: Partial<KeyMods> = {},
  button: ViewPointerEvent['button'] = 'left',
): ViewPointerEvent {
  return {
    type,
    x,
    y,
    button: type === 'move' || type === 'leave' ? null : button,
    mods: { ...NO_MODS, ...mods },
  };
}

function click(viewport: FakeViewport, x: number, y: number, mods: Partial<KeyMods> = {}): void {
  viewport.emitPointer(pointer('move', x, y, mods));
  viewport.emitPointer(pointer('down', x, y, mods));
  viewport.emitPointer(pointer('up', x, y, mods));
}

function escape(viewport: FakeViewport): void {
  viewport.emitKey({ key: 'Escape', mods: NO_MODS, inTextField: false });
}

/** Clicks the points in order and lets the writes settle. */
async function clicks(viewport: FakeViewport, points: readonly Vec2[]): Promise<void> {
  for (const [x, y] of points) {
    click(viewport, x, y);
    await settle();
  }
}

const pointsOf = (s: SketchSession) =>
  s.state
    .get()
    .entities.filter((e): e is Extract<SketchEntity, { kind: 'point' }> => e.kind === 'point');
const linesOf = (s: SketchSession) =>
  s.state
    .get()
    .entities.filter((e): e is Extract<SketchEntity, { kind: 'line' }> => e.kind === 'line');
const kindsOf = (s: SketchSession) => s.state.get().constraints.map((c) => c.kind);
const xyOf = (s: SketchSession, id: string): Vec2 | undefined => {
  const p = pointsOf(s).find((e) => e.id === id);
  return p === undefined ? undefined : [p.x, p.y];
};

describe('createSketchTools', () => {
  it('describes the tools of the sketcher (spec 10, "Nástroje a akce skicáře")', () => {
    const { tools } = setup();
    expect(
      tools.map(({ id, label, icon, group, modes, shortcut, family }) => ({
        id,
        label,
        icon,
        group,
        modes,
        shortcut,
        family,
      })),
    ).toEqual([
      {
        id: 'sketch',
        label: 'tool.sketch',
        icon: 'pencil',
        group: 'sketch',
        modes: ['model'],
        shortcut: 'Shift+S',
        family: undefined,
      },
      {
        id: 'sketch.select',
        label: 'tool.select',
        icon: 'pointer',
        group: 'select',
        modes: ['sketch'],
        shortcut: undefined,
        family: undefined,
      },
      {
        id: 'sketch.line',
        label: 'tool.line',
        icon: 'line',
        group: 'draw',
        modes: ['sketch'],
        shortcut: 'L',
        family: 'line',
      },
      {
        id: 'sketch.xline',
        label: 'tool.xline',
        icon: 'arrows-horizontal',
        group: 'draw',
        modes: ['sketch'],
        shortcut: undefined,
        family: 'line',
      },
      {
        id: 'sketch.rectangle',
        label: 'tool.rectangle',
        icon: 'square',
        group: 'draw',
        modes: ['sketch'],
        shortcut: 'R',
        family: 'rectangle',
      },
      {
        id: 'sketch.rectangleCenter',
        label: 'tool.rectangleCenter',
        icon: 'square-dot',
        group: 'draw',
        modes: ['sketch'],
        shortcut: undefined,
        family: 'rectangle',
      },
      {
        id: 'sketch.rectangle3p',
        label: 'tool.rectangle3p',
        icon: 'square-rotated',
        group: 'draw',
        modes: ['sketch'],
        shortcut: undefined,
        family: 'rectangle',
      },
      {
        id: 'sketch.circle',
        label: 'tool.circle',
        icon: 'circle',
        group: 'draw',
        modes: ['sketch'],
        shortcut: 'C',
        family: 'circle',
      },
      {
        id: 'sketch.circle2p',
        label: 'tool.circle2p',
        icon: 'circle-number-2',
        group: 'draw',
        modes: ['sketch'],
        shortcut: undefined,
        family: 'circle',
      },
      {
        id: 'sketch.circle3p',
        label: 'tool.circle3p',
        icon: 'circle-number-3',
        group: 'draw',
        modes: ['sketch'],
        shortcut: undefined,
        family: 'circle',
      },
      {
        id: 'sketch.circle2t',
        label: 'tool.circle2t',
        icon: 'circles-relation',
        group: 'draw',
        modes: ['sketch'],
        shortcut: undefined,
        family: 'circle',
      },
      {
        id: 'sketch.circle3t',
        label: 'tool.circle3t',
        icon: 'circle-letter-t',
        group: 'draw',
        modes: ['sketch'],
        shortcut: undefined,
        family: 'circle',
      },
      {
        id: 'sketch.arc',
        label: 'tool.arc',
        icon: 'chart-arcs',
        group: 'draw',
        modes: ['sketch'],
        shortcut: 'A',
        family: 'arc',
      },
      {
        id: 'sketch.arc3p',
        label: 'tool.arc3p',
        icon: 'chart-arcs-3',
        group: 'draw',
        modes: ['sketch'],
        shortcut: undefined,
        family: 'arc',
      },
      {
        id: 'sketch.arcTangent',
        label: 'tool.arcTangent',
        icon: 'ease-out',
        group: 'draw',
        modes: ['sketch'],
        shortcut: undefined,
        family: 'arc',
      },
      {
        id: 'sketch.spline',
        label: 'tool.spline',
        icon: 'vector-bezier',
        group: 'draw',
        modes: ['sketch'],
        family: 'spline',
        shortcut: undefined,
      },
      {
        id: 'sketch.fitSpline',
        label: 'tool.fitSpline',
        icon: 'vector-spline',
        group: 'draw',
        modes: ['sketch'],
        family: 'spline',
        shortcut: undefined,
      },
      {
        id: 'sketch.slot',
        label: 'tool.slot',
        icon: 'capsule-horizontal',
        group: 'draw',
        modes: ['sketch'],
        shortcut: undefined,
        family: 'slot',
      },
      {
        id: 'sketch.slotOverall',
        label: 'tool.slotOverall',
        icon: 'arrow-autofit-width',
        group: 'draw',
        modes: ['sketch'],
        shortcut: undefined,
        family: 'slot',
      },
      {
        id: 'sketch.slotArc',
        label: 'tool.slotArc',
        icon: 'rainbow',
        group: 'draw',
        modes: ['sketch'],
        shortcut: undefined,
        family: 'slot',
      },
      {
        id: 'sketch.point',
        label: 'tool.point',
        icon: 'point',
        group: 'draw',
        modes: ['sketch'],
        shortcut: 'P',
        family: undefined,
      },
      {
        id: 'sketch.dimension',
        label: 'tool.dimension',
        icon: 'ruler-measure',
        group: 'constrain',
        modes: ['sketch'],
        shortcut: 'D',
        family: undefined,
      },
    ]);
    expect(Object.isFrozen(tools)).toBe(true);
  });

  it('the slot tools are one family in the order slot, slotOverall, slotArc (M31)', () => {
    const { tools } = setup();
    expect(tools.filter((t) => t.family === 'slot').map((t) => t.id)).toEqual([
      'sketch.slot',
      'sketch.slotOverall',
      'sketch.slotArc',
    ]);
  });

  it('the arc tools are one family in the order arc, arc3p, arcTangent (M27)', () => {
    const { tools } = setup();
    expect(tools.filter((t) => t.family === 'arc').map((t) => t.id)).toEqual([
      'sketch.arc',
      'sketch.arc3p',
      'sketch.arcTangent',
    ]);
  });

  it('the rectangles and the lines are families with the old tool first (M31)', () => {
    const { tools } = setup();
    expect(tools.filter((t) => t.family === 'rectangle').map((t) => t.id)).toEqual([
      'sketch.rectangle',
      'sketch.rectangleCenter',
      'sketch.rectangle3p',
    ]);
    expect(tools.filter((t) => t.family === 'line').map((t) => t.id)).toEqual([
      'sketch.line',
      'sketch.xline',
    ]);
  });

  it('tools without an open session do nothing', () => {
    const { tools, ctx, viewport, sketches, doc } = setup();
    for (const descriptor of tools.filter((t) => t.id !== 'sketch')) {
      const tool = descriptor.create();
      tool.activate({ ...ctx, finish: () => undefined });
      tool.onPointer?.(pointer('move', 1, 1));
      tool.onPointer?.(pointer('down', 1, 1));
      tool.onPointer?.(pointer('up', 1, 1));
      expect(tool.onKey?.({ key: 'Escape', mods: NO_MODS, inTextField: false }) ?? false).toBe(
        false,
      );
      tool.deactivate();
    }
    expect(viewport.overlayShapes.size).toBe(0);
    expect(sketches.current.get()).toBeNull();
    expect(doc.studio.features).toEqual([]);
  });
});

describe('the entry tool sketch', () => {
  it('creates a sketch on the plane XY without a selected plane and finishes', () => {
    const { manager, sketches } = setup();
    const active: string[] = [];
    manager.active.subscribe(() => active.push(manager.active.get()));

    manager.activate('sketch');

    const session = sketches.current.get();
    expect(session?.plane.get()).toBe(XY);
    expect(sketches.mode.get()).toBe('sketch');
    expect(manager.active.get()).toBe('sketch.select');
    expect(active.at(-1)).toBe('sketch.select');
  });

  it('creates the sketch on the first selected plane', () => {
    const { manager, sketches, selection } = setup();
    selection.set([
      { kind: 'feature', feature: 'f9' as never }, // any other item is skipped
      { kind: 'plane', plane: ORIGIN_PLANE_IDS.xz },
      { kind: 'plane', plane: ORIGIN_PLANE_IDS.yz },
    ]);

    manager.activate('sketch');

    expect(sketches.current.get()?.plane.get()).toBe(XZ);
  });

  it('creates the sketch on a selected named planar face (M14)', () => {
    const { manager, sketches, selection, doc } = setup();
    selection.set([{ kind: 'face', body: BODY, faceIndex: 5 }]);

    manager.activate('sketch');

    const session = sketches.current.get();
    expect(session?.plane.get()).toBe(TOP);
    expect(doc.feature(session?.featureId ?? ('' as FeatureId))?.params).toMatchObject({
      plane: [{ kind: 'topo', body: BODY, name: 'b1/face:top' }],
    });
  });

  it('skips a face without a name and falls back to XY (M14)', () => {
    const { manager, sketches, selection } = setup();
    selection.set([{ kind: 'face', body: BODY, faceIndex: 1 }]);

    manager.activate('sketch');

    expect(sketches.current.get()?.plane.get()).toBe(XY);
  });

  it('skips a face without a plane (not planar) and falls back to XY (M14)', () => {
    const { manager, sketches, selection } = setup();
    selection.set([{ kind: 'face', body: BODY, faceIndex: 2 }]);

    manager.activate('sketch');

    expect(sketches.current.get()?.plane.get()).toBe(XY);
  });

  it('takes the first face with a plane after faces without one (M14)', () => {
    const { manager, sketches, selection } = setup();
    selection.set([
      { kind: 'face', body: BODY, faceIndex: 2 },
      { kind: 'face', body: BODY, faceIndex: 5 },
      { kind: 'face', body: BODY, faceIndex: 0 },
    ]);

    manager.activate('sketch');

    expect(sketches.current.get()?.plane.get()).toBe(TOP);
  });

  it('prefers a plane from the Browser to a selected face (M14)', () => {
    const { manager, sketches, selection } = setup();
    selection.set([
      { kind: 'face', body: BODY, faceIndex: 5 },
      { kind: 'plane', plane: ORIGIN_PLANE_IDS.yz },
    ]);

    manager.activate('sketch');

    expect(sketches.current.get()?.plane.get()).toBe(YZ);
  });

  it('with an open feature dialog only finishes', () => {
    const { manager, sketches, editor } = setup();
    editor.create('box');

    manager.activate('sketch');

    expect(sketches.current.get()).toBeNull();
    expect(manager.active.get()).toBe(SELECT_TOOL.id);
  });
});

describe('the line tool', () => {
  it('three clicks make two lines sharing their middle point', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.line');

    await clicks(viewport, [
      [10, 10],
      [30, 20],
      [40, 50],
    ]);

    const points = pointsOf(session);
    const lines = linesOf(session);
    expect(points.map((p) => [p.x, p.y])).toEqual([
      [10, 10],
      [30, 20],
      [40, 50],
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.p2).toBe(lines[1]?.p1);
    expect(lines[0]?.p1).toBe(points[0]?.id);
    expect(lines[1]?.p2).toBe(points[2]?.id);
    expect(session.state.get().constraints).toEqual([]);
  });

  it('a click on the first point of the chain closes it and ends it', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.line');

    await clicks(viewport, [
      [10, 10],
      [30, 20],
      [40, 50],
      [10, 10],
    ]);

    const points = pointsOf(session);
    const lines = linesOf(session);
    expect(points).toHaveLength(3);
    expect(lines).toHaveLength(3);
    expect(lines[2]?.p1).toBe(points[2]?.id);
    expect(lines[2]?.p2).toBe(points[0]?.id);
    // The chain is over: the next click starts a new one, no line from the first point.
    await clicks(viewport, [[70, 80]]);
    expect(linesOf(session)).toHaveLength(3);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
  });

  it('a nearly horizontal or vertical line gets horizontal or vertical', async () => {
    const { manager, viewport, session, sketches } = await sketching();
    // Off-grid points: the angle (or the place) is the point of the test, not the grid.
    sketches.setGridSnap(false);
    manager.activate('sketch.line');

    // 2.9° off the x axis, 2.9° off the y axis, then 60°; long enough that the ends lie farther
    // than the 6 px of the alignment snap from the axes of the points before.
    const t = Math.tan((2.9 * Math.PI) / 180);
    await clicks(viewport, [
      [10, 10],
      [210, 10 + 200 * t],
      [210 + 300 * t, 10 + 200 * t + 300],
      [300, 450],
    ]);

    const lines = linesOf(session);
    expect(lines).toHaveLength(3);
    expect(session.state.get().constraints).toEqual([
      expect.objectContaining({ kind: 'horizontal', line: lines[0]?.id }),
      expect.objectContaining({ kind: 'vertical', line: lines[1]?.id }),
    ]);
  });

  it('3.1° off an axis gets no constraint', async () => {
    const { manager, viewport, session, sketches } = await sketching();
    // Off-grid points: the angle (or the place) is the point of the test, not the grid.
    sketches.setGridSnap(false);
    manager.activate('sketch.line');
    const t = Math.tan((3.1 * Math.PI) / 180);

    await clicks(viewport, [
      [10, 10],
      [210, 10 + 200 * t],
    ]);

    expect(linesOf(session)).toHaveLength(1);
    expect(session.state.get().constraints).toEqual([]);
  });

  it('Escape ends the chain, a second Escape returns to sketch.select', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.line');
    await clicks(viewport, [
      [10, 10],
      [30, 20],
    ]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.line');
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
    await clicks(viewport, [[60, 70]]);
    expect(linesOf(session)).toHaveLength(1); // a new chain started at [60, 70]

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.line'); // the second chain is ended first
    escape(viewport);
    expect(manager.active.get()).toBe('sketch.select');
  });

  it('a snap onto an existing point reuses its id', async () => {
    const sketch = data([{ kind: 'point', id: 'p', x: 50, y: 50 }]);
    const { manager, viewport, session } = await sketching({ sketch });
    manager.activate('sketch.line');

    await clicks(viewport, [
      [50.5, 50.5],
      [80, 90],
    ]);

    const [line] = linesOf(session);
    expect(line?.p1).toBe('p');
    expect(pointsOf(session)).toHaveLength(2);
  });

  it('a snap onto the origin adds a point at [0, 0] with fix', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.line');

    await clicks(viewport, [
      [0.3, -0.2],
      [40, 30],
    ]);

    const [line] = linesOf(session);
    expect(line).toBeDefined();
    expect(line?.p1).not.toBe(ORIGIN_POINT_ID);
    expect(xyOf(session, line?.p1 ?? '')).toEqual([0, 0]);
    expect(session.state.get().constraints).toEqual([
      expect.objectContaining({ kind: 'fix', point: line?.p1 }),
    ]);
  });

  it('a point of another drawing is not snapped to', async () => {
    const { manager, viewport, session, sketches } = await sketching();
    // Off-grid points: the angle (or the place) is the point of the test, not the grid.
    sketches.setGridSnap(false);
    viewport.sketches.set('origin/plane:xy', {
      plane: XY,
      curves: [],
      points: [{ id: 'q', at: [20, 20], style: 'plane' }],
    });
    manager.activate('sketch.line');

    await clicks(viewport, [
      [20.5, 20],
      [40, 60],
    ]);

    expect(xyOf(session, linesOf(session)[0]?.p1 ?? '')).toEqual([20.5, 20]);
  });

  it('draws the rubber band in the overlay and removes it on deactivate', async () => {
    const { manager, viewport } = await sketching();
    manager.activate('sketch.line');
    click(viewport, 10, 10);
    await settle();

    viewport.emitPointer(pointer('move', 30, 40));

    expect(viewport.overlayShapes.get('sketch-tool')).toEqual([
      {
        kind: 'lines',
        points: [
          [10, 10, 0],
          [30, 40, 0],
        ],
        style: 'preview',
      },
    ]);
    manager.activate('sketch.select');
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
  });

  it('ignores a click whose ray is parallel to the plane', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.line');
    viewport.setScreenToRay((x, y) => ({ origin: [x, y, 5], direction: [1, 0, 0] }));

    await clicks(viewport, [
      [10, 10],
      [30, 20],
    ]);

    expect(session.state.get().entities).toEqual([]);
  });

  it('works on another plane through the ray (plane XZ)', async () => {
    const ctx = setup();
    ctx.selection.set([{ kind: 'plane', plane: ORIGIN_PLANE_IDS.xz }]);
    ctx.manager.activate('sketch');
    const session = ctx.sketches.current.get();
    if (session === null) throw new Error('no session');
    // Looking along +Y onto XZ: px x → world x, px y → world z.
    ctx.viewport.setScreenToRay((x, y): { origin: Vec3; direction: Vec3 } => ({
      origin: [x, -50, y],
      direction: [0, 1, 0],
    }));
    ctx.manager.activate('sketch.line');

    await clicks(ctx.viewport, [
      [10, 20],
      [30, 35],
    ]);

    const [p, q] = pointsOf(session);
    expect([p?.x, p?.y]).toEqual([10, 20]);
    expect([q?.x, q?.y]).toEqual([30, 35]);
  });
});

describe('the rectangle tool', () => {
  it('two corners make 4 points, 4 lines, 2× horizontal and 2× vertical', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.rectangle');

    await clicks(viewport, [
      [10, 10],
      [40, 30],
    ]);

    expect(pointsOf(session).map((p) => [p.x, p.y])).toEqual([
      [10, 10],
      [40, 10],
      [40, 30],
      [10, 30],
    ]);
    const lines = linesOf(session);
    expect(lines).toHaveLength(4);
    expect(kindsOf(session)).toEqual(['horizontal', 'vertical', 'horizontal', 'vertical']);
    const constraints = session.state.get().constraints as readonly Extract<
      SketchConstraint,
      { line: unknown }
    >[];
    expect(constraints.map((c) => c.line)).toEqual(lines.map((l) => l.id));
  });

  it('reuses snapped corners and fixes a corner on the origin', async () => {
    const sketch = data([{ kind: 'point', id: 'p', x: 40, y: 30 }]);
    const { manager, viewport, session } = await sketching({ sketch });
    manager.activate('sketch.rectangle');

    await clicks(viewport, [
      [0, 0],
      [40, 30],
    ]);

    const points = pointsOf(session);
    expect(points).toHaveLength(4);
    expect(linesOf(session).some((l) => l.p1 === 'p' || l.p2 === 'p')).toBe(true);
    expect(kindsOf(session).filter((k) => k === 'fix')).toHaveLength(1);
  });

  it('corners with the same x or y make nothing', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.rectangle');

    await clicks(viewport, [
      [10, 10],
      [10, 30],
    ]);
    expect(session.state.get().entities).toEqual([]);
    await clicks(viewport, [[40, 10]]);
    expect(session.state.get().entities).toEqual([]);
  });

  it('previews the rectangle after the first corner', async () => {
    const { manager, viewport } = await sketching();
    manager.activate('sketch.rectangle');
    click(viewport, 10, 10);

    viewport.emitPointer(pointer('move', 20, 30));

    const [shape] = viewport.overlayShapes.get('sketch-tool') ?? [];
    expect(shape?.kind).toBe('lines');
    expect(shape?.points).toHaveLength(8);
  });
});

describe('the circle tool', () => {
  it('a centre and a point on the rim make a circle', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.circle');

    await clicks(viewport, [
      [10, 10],
      [13, 14],
    ]);

    const [center, circle] = session.state.get().entities;
    expect(center).toMatchObject({ kind: 'point', x: 10, y: 10 });
    expect(circle).toMatchObject({ kind: 'circle', center: center?.id, radius: 5 });
  });

  it('a zero radius makes nothing', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.circle');

    await clicks(viewport, [
      [10, 10],
      [10, 10],
    ]);

    expect(session.state.get().entities).toEqual([]);
  });

  it('previews the circle as a polyline of 64 segments', async () => {
    const { manager, viewport } = await sketching();
    manager.activate('sketch.circle');
    click(viewport, 10, 10);

    viewport.emitPointer(pointer('move', 20, 10));

    const [shape] = viewport.overlayShapes.get('sketch-tool') ?? [];
    expect(shape?.points).toHaveLength(128);
    expect(shape?.points[0]).toEqual([20, 10, 0]);
  });
});

describe('the arc tool', () => {
  it('centre, start and end projected onto the circle make a counter-clockwise arc', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.arc');

    await clicks(viewport, [
      [10, 10],
      [20, 10],
      [10, 40],
    ]);

    const entities = session.state.get().entities;
    const arc = entities.find((e) => e.kind === 'arc');
    expect(arc).toBeDefined();
    if (arc?.kind !== 'arc') return;
    expect(xyOf(session, arc.center)).toEqual([10, 10]);
    expect(xyOf(session, arc.start)).toEqual([20, 10]);
    const end = xyOf(session, arc.end);
    expect(end?.[0]).toBeCloseTo(10, 9);
    expect(end?.[1]).toBeCloseTo(20, 9);
  });

  it('a start on the centre makes nothing', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.arc');

    await clicks(viewport, [
      [10, 10],
      [10, 10],
      [10, 40],
    ]);

    expect(session.state.get().entities).toEqual([]);
  });
});

describe('the construction mode (M31)', () => {
  /** The tools with the clicks that draw one shape of each. */
  const SHAPES: readonly (readonly [string, readonly Vec2[]])[] = [
    [
      'sketch.line',
      [
        [10, 10],
        [30, 20],
        [40, 50],
      ],
    ],
    [
      'sketch.rectangle',
      [
        [10, 10],
        [40, 30],
      ],
    ],
    [
      'sketch.circle',
      [
        [10, 10],
        [13, 14],
      ],
    ],
    [
      'sketch.arc',
      [
        [10, 10],
        [20, 10],
        [10, 40],
      ],
    ],
    [
      'sketch.circle2p',
      [
        [10, 10],
        [20, 10],
      ],
    ],
    [
      'sketch.circle3p',
      [
        [10, 10],
        [20, 10],
        [15, 20],
      ],
    ],
    [
      'sketch.arc3p',
      [
        [10, 10],
        [30, 10],
        [20, 15],
      ],
    ],
  ];

  /** The data the tool draws, without the construction flag of the curves. */
  async function drawn(tool: string, points: readonly Vec2[], mode: boolean) {
    const { manager, viewport, session } = await sketching();
    if (mode) session.setConstructionMode(true);
    manager.activate(tool);
    await clicks(viewport, points);
    return session.state.get();
  }

  const curvesOf = (entities: readonly SketchEntity[]) =>
    entities.filter((e) => e.kind !== 'point');
  const withoutConstruction = (entities: readonly SketchEntity[]) =>
    // toEqual takes an undefined field for a missing one.
    entities.map((e) => (e.kind === 'point' ? e : { ...e, construction: undefined }));

  for (const [tool, points] of SHAPES) {
    it(`${tool} draws construction curves in the mode, points and constraints unchanged`, async () => {
      const plain = await drawn(tool, points, false);
      const construction = await drawn(tool, points, true);

      expect(curvesOf(plain.entities).length).toBeGreaterThan(0);
      expect(curvesOf(plain.entities).every((e) => e.construction !== true)).toBe(true);
      expect(curvesOf(construction.entities).every((e) => e.construction === true)).toBe(true);
      expect(withoutConstruction(construction.entities)).toEqual(
        withoutConstruction(plain.entities),
      );
      expect(construction.constraints).toEqual(plain.constraints);
    });
  }

  it('survives a switch of the tool', async () => {
    const { manager, viewport, session } = await sketching();
    session.setConstructionMode(true);
    manager.activate('sketch.circle');
    manager.activate('sketch.line');
    await clicks(viewport, [
      [10, 10],
      [30, 20],
    ]);

    expect(session.state.get().constructionMode).toBe(true);
    expect(curvesOf(session.state.get().entities).map((e) => e.construction)).toEqual([true]);
  });
});

describe('the select tool of the sketch', () => {
  const sketch = data([
    { kind: 'point', id: 'p', x: 10, y: 10 },
    { kind: 'point', id: 'q', x: 40, y: 10 },
    { kind: 'line', id: 'pq', p1: 'p', p2: 'q' },
  ]);

  it('hovers entities of the session, not the origin', async () => {
    const { viewport, session, manager } = await sketching({ sketch });
    expect(manager.active.get()).toBe('sketch.select');

    viewport.emitPointer(pointer('move', 10, 10));
    expect(session.state.get().hover).toBe('p');
    viewport.emitPointer(pointer('move', 25, 10));
    expect(session.state.get().hover).toBe('pq');
    viewport.emitPointer(pointer('move', 0, 0));
    expect(session.state.get().hover).toBeNull();
    viewport.emitPointer(pointer('move', 10, 10));
    viewport.emitPointer(pointer('leave', 10, 10));
    expect(session.state.get().hover).toBeNull();
    expect(viewport.lastFilter).toEqual(['sketchEntity']);
  });

  it('a click selects, Shift adds, a click into empty space clears', async () => {
    const { viewport, session } = await sketching({ sketch });

    click(viewport, 10, 10);
    expect(session.state.get().selection).toEqual(['p']);
    click(viewport, 25, 10);
    expect(session.state.get().selection).toEqual(['pq']);
    click(viewport, 10, 10, { shift: true });
    expect(session.state.get().selection).toEqual(['pq', 'p']);
    click(viewport, 10, 10, { shift: true });
    expect(session.state.get().selection).toEqual(['pq']);
    click(viewport, 200, 200);
    expect(session.state.get().selection).toEqual([]);
  });

  it('the control polygon of a bspline hovers and selects the spline (M29)', async () => {
    // The polygon (0,100)–(50,200)–(100,100) of a quadratic: (25,150) lies on it, not on the
    // curve, which passes (25,137.5) at t = 0.25.
    const spline = data([
      { kind: 'point', id: 'a', x: 0, y: 100 },
      { kind: 'point', id: 'b', x: 50, y: 200 },
      { kind: 'point', id: 'c', x: 100, y: 100 },
      { kind: 'bspline', id: 'sp', degree: 2, poles: ['a', 'b', 'c'], knots: [0, 0, 0, 1, 1, 1] },
    ]);
    const { viewport, session } = await sketching({ sketch: spline });
    expect(viewport.pick(25, 150, ['sketchEntity'])).toMatchObject({ entity: '__poles:sp' });

    viewport.emitPointer(pointer('move', 25, 150));
    expect(session.state.get().hover).toBe('sp');
    click(viewport, 25, 150);
    expect(session.state.get().selection).toEqual(['sp']);
  });

  it('Escape with a selection clears it', async () => {
    const { viewport, session, manager } = await sketching({ sketch });
    click(viewport, 10, 10);

    escape(viewport);

    expect(session.state.get().selection).toEqual([]);
    expect(manager.active.get()).toBe('sketch.select');
  });

  it('dragging a point solves with drag on every move and ends the drag on release', async () => {
    const { viewport, session, solver } = await sketching({ sketch });
    const before = solver.calls.length;

    viewport.emitPointer(pointer('down', 10, 10));
    viewport.emitPointer(pointer('move', 12, 12)); // within 4 px: not a drag yet
    expect(solver.calls).toHaveLength(before);
    viewport.emitPointer(pointer('move', 20, 15));
    await settle();
    viewport.emitPointer(pointer('move', 25, 18));
    await settle();
    viewport.emitPointer(pointer('up', 25, 18));
    await settle();

    expect(solver.calls.slice(before).map((c) => c.drag)).toEqual([
      { point: 'p', to: [20, 15] },
      { point: 'p', to: [25, 18] },
    ]);
    expect(xyOf(session, 'p')).toEqual([25, 18]);
    expect(session.state.get().selection).toEqual([]);
  });

  it('a press on a curve and a long move is not a drag nor a click', async () => {
    const { viewport, session, solver } = await sketching({ sketch });
    const before = solver.calls.length;

    viewport.emitPointer(pointer('down', 25, 10));
    viewport.emitPointer(pointer('move', 40, 40));
    viewport.emitPointer(pointer('up', 40, 40));
    await settle();

    expect(solver.calls).toHaveLength(before);
    expect(session.state.get().selection).toEqual([]);
  });

  it('a small move is a click', async () => {
    const { viewport, session, solver } = await sketching({ sketch });
    const before = solver.calls.length;

    viewport.emitPointer(pointer('down', 10, 10));
    viewport.emitPointer(pointer('move', 10.5, 10.5));
    viewport.emitPointer(pointer('up', 10.5, 10.5));
    await settle();

    expect(solver.calls).toHaveLength(before);
    expect(session.state.get().selection).toEqual(['p']);
  });

  it('a pointer up after the session closed does nothing', async () => {
    const { viewport, session, sketches } = await sketching({ sketch });
    viewport.emitPointer(pointer('down', 10, 10));
    viewport.emitPointer(pointer('move', 20, 20));

    session.finish();

    expect(sketches.current.get()).toBeNull();
    expect(() => {
      viewport.emitPointer(pointer('move', 30, 30));
      viewport.emitPointer(pointer('up', 30, 30));
    }).not.toThrow();
    await settle();
  });

  it('the right button is ignored', async () => {
    const { viewport, session } = await sketching({ sketch });

    viewport.emitPointer(pointer('down', 10, 10, {}, 'right'));
    viewport.emitPointer(pointer('up', 10, 10, {}, 'right'));

    expect(session.state.get().selection).toEqual([]);
  });

  it('the drawing of the edited sketch is what the tools pick', async () => {
    const { viewport } = await sketching({ sketch });
    expect(viewport.sketchDrawings.has(EDIT_SKETCH_DRAWING_ID)).toBe(true);
  });
});

describe('snapAt (M19.2 D4, M26)', () => {
  const lineSketch = data([
    { kind: 'point', id: 'p', x: 31.4, y: -2.6 },
    { kind: 'point', id: 'l1', x: -50, y: 20 },
    { kind: 'point', id: 'l2', x: 50, y: 20 },
    { kind: 'line', id: 'l', p1: 'l1', p2: 'l2' },
  ]);

  async function snapping() {
    const s = await sketching({ sketch: lineSketch });
    const ctx: ToolContext = { ...s.ctx, finish: () => undefined };
    return {
      ...s,
      at: (x: number, y: number, grid: number | null, infer = true) =>
        snapAt(ctx, s.session, x, y, { grid, infer }),
    };
  }

  const free = (at: Vec2, kind: 'free' | 'grid') => ({
    at,
    kind,
    point: null,
    inferred: [],
    guides: [],
  });

  it('rounds a free point to the multiples of the grid step', async () => {
    const { at } = await snapping();
    expect(at(11.4, -12.6, 1)).toEqual(free([11, -13], 'grid'));
    expect(at(17, 8, 5)).toEqual(free([15, 10], 'grid'));
  });

  it('without the grid (null) the free point stays where the cursor is', async () => {
    const { at } = await snapping();
    expect(at(11.4, -12.6, null)).toEqual(free([11.4, -12.6], 'free'));
  });

  it('a rounded −0 is 0', async () => {
    const { at } = await snapping();
    const target = at(-1.2, 7, 5);
    expect(Object.is(target?.at[0], 0)).toBe(true);
    expect(target?.at[1]).toBe(5);
  });

  it('a point of the sketch within 6 px wins over the grid', async () => {
    const { at } = await snapping();
    expect(at(35, -2.5, 1)).toMatchObject({ kind: 'point', point: 'p', at: [31.4, -2.6] });
    expect(at(37.5, -2.6, 1)?.kind).not.toBe('point');
  });

  it('the tolerance is 6 px converted to the plane at the cursor', async () => {
    const { at, viewport } = await snapping();
    // Zoomed out: 1 px = 2 mm, so 6 px = 12 mm.
    viewport.setScreenToRay((x, y) => ({ origin: [2 * x, 2 * y, 10], direction: [0, 0, -1] }));
    expect(at(21.5 / 2, -2.6 / 2, null)).toMatchObject({ kind: 'point', point: 'p' });
    expect(at(19 / 2, -2.6 / 2, null)?.kind).not.toBe('point');
  });

  it('the origin wins over the grid and gets fix', async () => {
    const { at } = await snapping();
    expect(at(0.3, 0.6, 5)).toMatchObject({
      kind: 'origin',
      at: [0, 0],
      inferred: [{ kind: 'fix' }],
    });
  });

  it('a point near a curve snaps onto it with pointOnCurve', async () => {
    const { at } = await snapping();
    const target = at(12.3, 21.2, 1);
    expect(target).toMatchObject({
      kind: 'onCurve',
      point: null,
      inferred: [{ kind: 'pointOnCurve', curve: 'l' }],
    });
    expect(target?.at[0]).toBeCloseTo(12.3, 9);
    expect(target?.at[1]).toBe(20);
  });

  it('without infer (Ctrl/Cmd) a curve is not snapped to, a point still is', async () => {
    const { at } = await snapping();
    expect(at(12.3, 21.2, 1, false)).toEqual(free([12, 21], 'grid'));
    expect(at(35, -2.5, 1, false)).toMatchObject({ kind: 'point', point: 'p' });
  });

  it('a ray parallel to the plane gives null', async () => {
    const { at, viewport } = await snapping();
    viewport.setScreenToRay((x, y) => ({ origin: [x, y, 5], direction: [1, 0, 0] }));
    expect(at(10, 10, 1)).toBeNull();
  });
});

describe('the drawing tools and the grid (M19.2 D4)', () => {
  it('the line tool snaps new points to the grid of step 1 by default', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.line');

    await clicks(viewport, [
      [10.4, 20.6],
      [30.3, 40.2],
    ]);

    expect(pointsOf(session).map((p) => [p.x, p.y])).toEqual([
      [10, 21],
      [30, 40],
    ]);
  });

  it('with Alt held the points do not snap to the grid', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.line');

    click(viewport, 10.4, 20.6, { alt: true });
    await settle();
    click(viewport, 30.3, 40.2, { alt: true });
    await settle();

    expect(pointsOf(session).map((p) => [p.x, p.y])).toEqual([
      [10.4, 20.6],
      [30.3, 40.2],
    ]);
  });

  it('with setGridSnap(false) the points do not snap to the grid', async () => {
    const { manager, viewport, session, sketches } = await sketching();
    sketches.setGridSnap(false);
    manager.activate('sketch.line');

    await clicks(viewport, [
      [10.4, 20.6],
      [30.3, 40.2],
    ]);

    expect(pointsOf(session).map((p) => [p.x, p.y])).toEqual([
      [10.4, 20.6],
      [30.3, 40.2],
    ]);
  });

  it('snaps to the step of gridStep, read on every click', async () => {
    let step = 5;
    const { manager, viewport, session } = await sketching({ gridStep: () => step });
    manager.activate('sketch.line');

    await clicks(viewport, [[17, 13]]);
    step = 2;
    await clicks(viewport, [[27, 3.2]]);

    expect(pointsOf(session).map((p) => [p.x, p.y])).toEqual([
      [15, 15],
      [28, 4],
    ]);
  });

  it('the preview shows the snapped point; with Alt the cursor', async () => {
    const { manager, viewport } = await sketching();
    manager.activate('sketch.line');
    click(viewport, 10, 10);
    await settle();

    viewport.emitPointer(pointer('move', 30.4, 39.6));
    expect(viewport.overlayShapes.get('sketch-tool')).toEqual([
      expect.objectContaining({
        points: [
          [10, 10, 0],
          [30, 40, 0],
        ],
      }),
    ]);

    viewport.emitPointer(pointer('move', 30.4, 39.6, { alt: true }));
    expect(viewport.overlayShapes.get('sketch-tool')).toEqual([
      expect.objectContaining({
        points: [
          [10, 10, 0],
          [30.4, 39.6, 0],
        ],
      }),
    ]);
  });

  it('horizontal and vertical of the line follow the snapped points', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.line');

    // 3.1° off the x axis under the cursor, 3.0° once snapped to (10, 10) and (300, 25).
    await clicks(viewport, [
      [10, 9.51],
      [300, 25.4],
    ]);

    expect(kindsOf(session)).toEqual(['horizontal']);
  });

  it('the rectangle, circle and arc tools snap their points to the grid', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.rectangle');
    await clicks(viewport, [
      [10.4, 10.4],
      [30.6, 20.3],
    ]);
    manager.activate('sketch.circle');
    await clicks(viewport, [
      [50.2, 50.3],
      [53.4, 54.2],
    ]);
    manager.activate('sketch.arc');
    await clicks(viewport, [
      [80.3, 80.2],
      [85.2, 79.8],
      [80.1, 90],
    ]);

    expect(pointsOf(session).map((p) => [p.x, p.y])).toEqual([
      [10, 10],
      [31, 10],
      [31, 20],
      [10, 20],
      [50, 50],
      [80, 80],
      [85, 80],
      [80, 85],
    ]);
    const circle = session.state.get().entities.find((e) => e.kind === 'circle');
    expect(circle).toMatchObject({ radius: 5 });
  });
});

describe('the drawing tools infer constraints (M26)', () => {
  /** A horizontal line from (0, 50) to (100, 50), its middle at (50, 50). */
  const lineSketch = data([
    { kind: 'point', id: 'l1', x: 0, y: 50 },
    { kind: 'point', id: 'l2', x: 100, y: 50 },
    { kind: 'line', id: 'l', p1: 'l1', p2: 'l2' },
  ]);
  const constraintsOf = (s: SketchSession) => s.state.get().constraints;

  it('a point put onto a line gets pointOnCurve', async () => {
    const { manager, viewport, session } = await sketching({ sketch: lineSketch });
    manager.activate('sketch.line');

    await clicks(viewport, [
      [30, 52],
      [70, 90],
    ]);

    const [, , first] = pointsOf(session);
    expect(xyOf(session, first?.id ?? '')).toEqual([30, 50]);
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'pointOnCurve', point: first?.id, curve: 'l' }),
    ]);
  });

  it('a point put onto the middle of a line gets midpoint', async () => {
    const { manager, viewport, session } = await sketching({ sketch: lineSketch });
    manager.activate('sketch.circle');

    await clicks(viewport, [
      [51, 52],
      [61, 70],
    ]);

    const circle = session.state.get().entities.find((e) => e.kind === 'circle');
    expect(circle?.kind === 'circle' && xyOf(session, circle.center)).toEqual([50, 50]);
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'midpoint', line: 'l' }),
    ]);
  });

  it('a point aligned with another one gets hAlign or vAlign', async () => {
    const { manager, viewport, session } = await sketching({ sketch: lineSketch });
    manager.activate('sketch.circle');

    await clicks(viewport, [
      [102, 120],
      [130, 140],
    ]);

    const [center] = pointsOf(session).slice(-1);
    expect([center?.x, center?.y]).toEqual([100, 120]);
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'vAlign', a: center?.id, b: 'l2' }),
    ]);
  });

  it('a line nearly perpendicular to the previous one gets perpendicular', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.line');

    // (100, 20) and then (−16, 80): perpendicular; no axis, other length.
    await clicks(viewport, [
      [10, 10],
      [110, 30],
      [94, 110],
    ]);

    const [l1, l2] = linesOf(session);
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'perpendicular', a: l2?.id, b: l1?.id }),
    ]);
  });

  it('a line from the end of a line nearly along it gets parallel, not also equal', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.line');

    // The third line is 0.6° off the second and about as long: one constraint per pair.
    await clicks(viewport, [
      [10, 10],
      [110, 30],
      [150, 120],
      [190, 211],
    ]);

    const [, l2, l3] = linesOf(session);
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'parallel', a: l3?.id, b: l2?.id }),
    ]);
  });

  it('a line as long as the previous one of the chain gets equal', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.line');

    // 100 long, then 101 long at 60°: within 2 %.
    await clicks(viewport, [
      [10, 10],
      [110, 30],
      [110 - 61, 30 + 81],
    ]);

    const [l1, l2] = linesOf(session);
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'equal', a: l2?.id, b: l1?.id }),
    ]);
  });

  it('a line from the end of an arc along its tangent gets tangent', async () => {
    // An arc of radius 50 from 0° to 60°; at its end the tangent runs at 150°.
    const sketch = data([
      { kind: 'point', id: 'c', x: 100, y: 100 },
      { kind: 'point', id: 's', x: 150, y: 100 },
      { kind: 'point', id: 'e', x: 125, y: 100 + 50 * Math.sin(Math.PI / 3) },
      { kind: 'arc', id: 'a', center: 'c', start: 's', end: 'e' },
    ]);
    const { manager, viewport, session } = await sketching({ sketch });
    manager.activate('sketch.line');

    // (38, 192) lies 0.8° off the tangent from the end.
    await clicks(viewport, [
      [125, 143],
      [38, 192],
    ]);

    const [line] = linesOf(session);
    expect(line?.p1).toBe('e');
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'tangent', a: line?.id, b: 'a' }),
    ]);
  });

  it('with Ctrl/Cmd the tools add no inferred constraints, only shared points and fix', async () => {
    const { manager, viewport, session } = await sketching({ sketch: lineSketch });
    manager.activate('sketch.line');

    // From the origin onto the line (pointOnCurve) and then horizontal and aligned: all off.
    for (const [x, y] of [
      [0.5, 0.5],
      [30, 52],
      [130, 53],
      [101, 51],
    ] as const) {
      click(viewport, x, y, { mod: true });
      await settle();
    }

    const lines = linesOf(session).slice(1);
    expect(lines).toHaveLength(3);
    expect(lines[2]?.p2).toBe('l2');
    expect(xyOf(session, lines[1]?.p1 ?? '')).toEqual([30, 52]);
    expect(kindsOf(session)).toEqual(['fix']);
  });

  it('the first point of the chain closes it before its write has settled', async () => {
    const { manager, viewport, session, solver } = await sketching();
    manager.activate('sketch.line');
    solver.hold();

    for (const [x, y] of [
      [10, 10],
      [110, 30],
      [60, 120],
      [11, 11],
    ] as const) {
      click(viewport, x, y);
    }
    solver.release();
    await settle();

    const points = pointsOf(session);
    const lines = linesOf(session);
    expect(points).toHaveLength(3);
    expect(lines).toHaveLength(3);
    expect(lines[2]?.p2).toBe(points[0]?.id);
  });

  it('a rectangle over a whole existing edge shares its points and adds no second line', async () => {
    // The edge (0, 30)–(40, 30); the rectangle from its start to (40, 60) has it as a side.
    const edge = data([
      { kind: 'point', id: 'e1', x: 0, y: 30 },
      { kind: 'point', id: 'e2', x: 40, y: 30 },
      { kind: 'line', id: 'e', p1: 'e1', p2: 'e2' },
    ]);
    const { manager, viewport, session } = await sketching({ sketch: edge });
    manager.activate('sketch.rectangle');

    await clicks(viewport, [
      [1, 31],
      [40, 60],
    ]);

    const lines = linesOf(session).slice(1);
    expect(lines).toHaveLength(3);
    expect(pointsOf(session)).toHaveLength(4);
    const [bc, cd, da] = lines;
    expect(bc?.p1).toBe('e2');
    expect(da?.p2).toBe('e1');
    // No alignment of the corner (40, 60) with the corner e2, no axis of the existing side.
    expect(session.state.get().constraints).toEqual([
      expect.objectContaining({ kind: 'vertical', line: bc?.id }),
      expect.objectContaining({ kind: 'horizontal', line: cd?.id }),
      expect.objectContaining({ kind: 'vertical', line: da?.id }),
    ]);
  });

  it('a polyline between two points an existing line joins adds no line and goes on', async () => {
    const { manager, viewport, session } = await sketching({ sketch: lineSketch });
    manager.activate('sketch.line');

    await clicks(viewport, [
      [0, 50],
      [100, 50],
      [130, 90],
    ]);

    const lines = linesOf(session);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ p1: 'l2' });
  });

  it('an alignment with the start of the line becomes horizontal or vertical of the line', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.line');

    // (110, 15) is aligned with (10, 10) and 2.9° off the axis: one horizontal, no hAlign.
    await clicks(viewport, [
      [10, 10],
      [110, 15],
      [113, 60],
    ]);

    const [l1, l2] = linesOf(session);
    expect(xyOf(session, l1?.p2 ?? '')).toEqual([110, 10]);
    expect(session.state.get().constraints).toEqual([
      expect.objectContaining({ kind: 'horizontal', line: l1?.id }),
      expect.objectContaining({ kind: 'vertical', line: l2?.id }),
    ]);
  });

  it('the horizontals and verticals of the rectangle are required', async () => {
    const { manager, viewport, session, solver } = await sketching({ sketch: lineSketch });
    manager.activate('sketch.rectangle');
    // The corner on the line gets pointOnCurve; the solver finds a conflict in everything.
    solver.next({ status: 'conflict', entities: null, conflicting: [] });

    await clicks(viewport, [
      [30, 52],
      [70, 90],
    ]);

    expect(kindsOf(session)).toEqual(['horizontal', 'vertical', 'horizontal', 'vertical']);
  });

  it('a circle with nearly the radius of the last circle or arc gets equal', async () => {
    const sketch = data([
      { kind: 'point', id: 'c', x: 100, y: 100 },
      { kind: 'circle', id: 'k', center: 'c', radius: 20 },
    ]);
    const { manager, viewport, session, sketches } = await sketching({ sketch });
    sketches.setGridSnap(false);
    manager.activate('sketch.circle');

    await clicks(viewport, [
      [200, 160],
      [220.3, 160],
    ]);

    const circle = session.state.get().entities.findLast((e) => e.kind === 'circle');
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'equal', a: circle?.id, b: 'k' }),
    ]);
  });

  it('an arc with nearly the radius of the last circle or arc gets equal', async () => {
    const sketch = data([
      { kind: 'point', id: 'c', x: 100, y: 100 },
      { kind: 'circle', id: 'k', center: 'c', radius: 20 },
    ]);
    const { manager, viewport, session } = await sketching({ sketch });
    manager.activate('sketch.arc');

    await clicks(viewport, [
      [200, 160],
      [220, 162],
      [180, 190],
    ]);

    const arc = session.state.get().entities.find((e) => e.kind === 'arc');
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'equal', a: arc?.id, b: 'k' }),
    ]);
  });

  it('the end of an arc is a new point on the circle without inferred constraints', async () => {
    const { manager, viewport, session } = await sketching({ sketch: lineSketch });
    manager.activate('sketch.arc');

    // The cursor of the end (200, 52) snaps into hAlign with l2; projected onto the circle it is
    // at (200, 80), where that alignment would not hold.
    await clicks(viewport, [
      [200, 100],
      [220, 100],
      [200, 52],
    ]);

    const arc = session.state.get().entities.find((e) => e.kind === 'arc');
    expect(arc?.kind === 'arc' && xyOf(session, arc.end)).toEqual([200, 80]);
    expect(constraintsOf(session)).toEqual([]);
  });
});

describe('the drawing tools preview the inferred constraints (M26)', () => {
  /** A horizontal line from (0, 50) to (100, 50), its middle at (50, 50). */
  const lineSketch = data([
    { kind: 'point', id: 'l1', x: 0, y: 50 },
    { kind: 'point', id: 'l2', x: 100, y: 50 },
    { kind: 'line', id: 'l', p1: 'l1', p2: 'l2' },
  ]);
  const inferenceOf = (s: SketchSession) => s.state.get().inference;
  const move = (viewport: FakeViewport, x: number, y: number, mods: Partial<KeyMods> = {}) => {
    viewport.emitPointer(pointer('move', x, y, mods));
  };

  it('a move over a line previews pointOnCurve at the snapped point', async () => {
    const { manager, viewport, session } = await sketching({ sketch: lineSketch });
    manager.activate('sketch.line');

    move(viewport, 30, 52);

    expect(inferenceOf(session)).toEqual({ anchor: [30, 50, 0], kinds: ['pointOnCurve'] });
    expect(viewport.overlayShapes.has('sketch-guides')).toBe(false);
  });

  it('an alignment previews its constraint and draws its guide as a construction line', async () => {
    const { manager, viewport, session } = await sketching({ sketch: lineSketch });
    manager.activate('sketch.line');

    move(viewport, 102, 120);

    expect(inferenceOf(session)).toEqual({ anchor: [100, 120, 0], kinds: ['vAlign'] });
    const [guide] = viewport.overlayShapes.get('sketch-guides') ?? [];
    expect(guide).toMatchObject({ kind: 'lines', style: 'construction' });
    expect(guide?.points).toHaveLength(2);
    expect(guide?.points).toContainEqual([100, 50, 0]);
  });

  it('previews what the click adds: an alignment with the start of the line becomes its axis', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.line');
    await clicks(viewport, [[10, 10]]);

    move(viewport, 110, 15);

    expect(inferenceOf(session)).toEqual({ anchor: [110, 10, 0], kinds: ['horizontal'] });
  });

  it('previews perpendicular of a line nearly perpendicular to the previous one', async () => {
    const { manager, viewport, session } = await sketching();
    manager.activate('sketch.line');
    await clicks(viewport, [
      [10, 10],
      [110, 30],
    ]);

    move(viewport, 94, 110);

    expect(inferenceOf(session)?.kinds).toEqual(['perpendicular']);
  });

  it('the rectangle previews the inferences of its corners b, c and d', async () => {
    const { manager, viewport, session } = await sketching({ sketch: lineSketch });
    manager.activate('sketch.rectangle');
    await clicks(viewport, [[10, 10]]);

    // The corner c (30, 52) and the computed corner d (10, 52) snap onto the line.
    move(viewport, 30, 52);

    expect(inferenceOf(session)?.kinds).toEqual(['pointOnCurve', 'pointOnCurve']);
  });

  it('the circle previews equal with the last circle of nearly the same radius', async () => {
    const sketch = data([
      { kind: 'point', id: 'k0', x: 200, y: 200 },
      { kind: 'circle', id: 'k', center: 'k0', radius: 10 },
    ]);
    const { manager, viewport, session } = await sketching({ sketch });
    manager.activate('sketch.circle');
    await clicks(viewport, [[130, 150]]);

    // The rim snaps to the grid (step 1): radius 11 is 10 % off, 10.2 within 2 % (Alt: no grid).
    move(viewport, 141, 150);
    expect(inferenceOf(session)).toBeNull();

    move(viewport, 140.2, 150, { alt: true });
    expect(inferenceOf(session)).toEqual({ anchor: [140.2, 150, 0], kinds: ['equal'] });
  });

  it('a click removes the preview', async () => {
    const { manager, viewport, session } = await sketching({ sketch: lineSketch });
    manager.activate('sketch.line');

    click(viewport, 102, 120);

    expect(inferenceOf(session)).toBeNull();
    expect(viewport.overlayShapes.has('sketch-guides')).toBe(false);
  });

  it('Escape removes the preview', async () => {
    const { manager, viewport, session } = await sketching({ sketch: lineSketch });
    manager.activate('sketch.line');
    await clicks(viewport, [[10, 10]]);
    move(viewport, 102, 120);

    escape(viewport);

    expect(inferenceOf(session)).toBeNull();
    expect(viewport.overlayShapes.has('sketch-guides')).toBe(false);
  });

  it('the pointer leaving the view removes the preview', async () => {
    const { manager, viewport, session } = await sketching({ sketch: lineSketch });
    manager.activate('sketch.line');
    move(viewport, 102, 120);

    viewport.emitPointer(pointer('leave', 102, 120));

    expect(inferenceOf(session)).toBeNull();
    expect(viewport.overlayShapes.has('sketch-guides')).toBe(false);
  });

  it('deactivating the tool removes the preview', async () => {
    const { manager, viewport, session } = await sketching({ sketch: lineSketch });
    manager.activate('sketch.circle');
    move(viewport, 102, 120);

    manager.activate('sketch.select');

    expect(inferenceOf(session)).toBeNull();
    expect(viewport.overlayShapes.has('sketch-guides')).toBe(false);
  });

  it('the end of an arc previews neither constraints nor guides', async () => {
    const { manager, viewport, session } = await sketching({ sketch: lineSketch });
    manager.activate('sketch.arc');
    await clicks(viewport, [
      [200, 100],
      [220, 100],
    ]);

    move(viewport, 200, 52);

    expect(inferenceOf(session)).toBeNull();
    expect(viewport.overlayShapes.has('sketch-guides')).toBe(false);
  });

  it('with Ctrl/Cmd nothing is previewed, neither constraints nor guides', async () => {
    const { manager, viewport, session } = await sketching({ sketch: lineSketch });
    manager.activate('sketch.line');

    move(viewport, 30, 52, { mod: true });
    expect(inferenceOf(session)).toBeNull();

    move(viewport, 102, 120, { mod: true });
    expect(inferenceOf(session)).toBeNull();
    expect(viewport.overlayShapes.has('sketch-guides')).toBe(false);
  });
});
