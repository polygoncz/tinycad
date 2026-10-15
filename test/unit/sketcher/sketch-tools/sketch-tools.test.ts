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
import { createFakeSolver } from '@/sketch/testing';
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
  const [ax, ay] = c.from;
  const [bx, by] = c.to;
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
      tools.map(({ id, label, icon, group, modes, shortcut }) => ({
        id,
        label,
        icon,
        group,
        modes,
        shortcut,
      })),
    ).toEqual([
      {
        id: 'sketch',
        label: 'tool.sketch',
        icon: 'pencil',
        group: 'sketch',
        modes: ['model'],
        shortcut: 'Shift+S',
      },
      {
        id: 'sketch.select',
        label: 'tool.select',
        icon: 'pointer',
        group: 'select',
        modes: ['sketch'],
        shortcut: undefined,
      },
      {
        id: 'sketch.line',
        label: 'tool.line',
        icon: 'line',
        group: 'draw',
        modes: ['sketch'],
        shortcut: 'L',
      },
      {
        id: 'sketch.rectangle',
        label: 'tool.rectangle',
        icon: 'square',
        group: 'draw',
        modes: ['sketch'],
        shortcut: 'R',
      },
      {
        id: 'sketch.circle',
        label: 'tool.circle',
        icon: 'circle',
        group: 'draw',
        modes: ['sketch'],
        shortcut: 'C',
      },
      {
        id: 'sketch.arc',
        label: 'tool.arc',
        icon: 'chart-arcs',
        group: 'draw',
        modes: ['sketch'],
        shortcut: 'A',
      },
      {
        id: 'sketch.dimension',
        label: 'tool.dimension',
        icon: 'ruler-measure',
        group: 'constrain',
        modes: ['sketch'],
        shortcut: 'D',
      },
    ]);
    expect(Object.isFrozen(tools)).toBe(true);
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

    // 2.9° off the x axis, 2.9° off the y axis, then 45°.
    const t = Math.tan((2.9 * Math.PI) / 180);
    await clicks(viewport, [
      [10, 10],
      [110, 10 + 100 * t],
      [110 + 100 * t, 110 + 100 * t],
      [150, 150 + 100 * t + 40],
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
      [110, 10 + 100 * t],
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

  it('a pick of another drawing counts as no snap', async () => {
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
      [30, 25],
    ]);

    const [p, q] = pointsOf(session);
    expect([p?.x, p?.y]).toEqual([10, 20]);
    expect([q?.x, q?.y]).toEqual([30, 25]);
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

describe('snapAt with the grid (M19.2 D4)', () => {
  const lineSketch = data([
    { kind: 'point', id: 'p', x: 1.4, y: -2.6 },
    { kind: 'point', id: 'l1', x: -50, y: 20 },
    { kind: 'point', id: 'l2', x: 50, y: 20 },
    { kind: 'line', id: 'l', p1: 'l1', p2: 'l2' },
  ]);

  async function snapping() {
    const s = await sketching({ sketch: lineSketch });
    const ctx: ToolContext = { ...s.ctx, finish: () => undefined };
    return {
      ...s,
      at: (x: number, y: number, grid: number | null) => snapAt(ctx, s.session, x, y, grid),
    };
  }

  it('rounds a free point to the multiples of the grid step', async () => {
    const { at } = await snapping();
    expect(at(11.4, -12.6, 1)).toEqual({ kind: 'free', at: [11, -13] });
    expect(at(7, 3, 5)).toEqual({ kind: 'free', at: [5, 5] });
  });

  it('without the grid (null) the free point stays where the cursor is', async () => {
    const { at } = await snapping();
    expect(at(11.4, -12.6, null)).toEqual({ kind: 'free', at: [11.4, -12.6] });
  });

  it('a rounded −0 is 0', async () => {
    const { at } = await snapping();
    const target = at(-1.2, 7, 5);
    expect(Object.is(target?.at[0], 0)).toBe(true);
    expect(target?.at[1]).toBe(5);
  });

  it('a point of the sketch within the tolerance wins over the grid', async () => {
    const { at } = await snapping();
    expect(at(1.5, -2.5, 1)).toEqual({ kind: 'point', id: 'p', at: [1.4, -2.6] });
  });

  it('the origin wins over the grid', async () => {
    const { at } = await snapping();
    expect(at(0.3, 0.6, 5)?.kind).toBe('origin');
  });

  it('a hit of a curve gives a free point, rounded too', async () => {
    const { at, viewport } = await snapping();
    expect(viewport.pick(12.3, 20.2, ['sketchEntity'])).toMatchObject({ entity: 'l' });
    expect(at(12.3, 20.2, 1)).toEqual({ kind: 'free', at: [12, 20] });
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

    await clicks(viewport, [[7, 3]]);
    step = 2;
    await clicks(viewport, [[7, 3.2]]);

    expect(pointsOf(session).map((p) => [p.x, p.y])).toEqual([
      [5, 5],
      [8, 4],
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

    // 3.1° off the x axis under the cursor, 2.9° once snapped to (10, 10) and (30, 9).
    await clicks(viewport, [
      [10, 10.49],
      [30, 9.4],
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
