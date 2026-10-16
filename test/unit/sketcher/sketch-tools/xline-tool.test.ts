import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Vec2 } from '@/core';
import { ORIGIN_PLANE_IDS, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, parseSketchData } from '@/sketch';
import type { SketchConstraint, SketchData, SketchEntity } from '@/sketch';
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

// The construction line tool of M31 (spec 12, "Nové kreslicí nástroje (M31)", "Nástroje"):
// sketch.xline. An open new sketch on the plane XY with the tools of the sketcher, the FakeSolver
// and the FakeViewport (in its default top view px = the local XY of the plane, 1 px = 1 mm). The
// tool snaps through the snapper, so the fake needs no pick.

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

/** A lone point m (50, 50). */
const LONE_POINT = data([{ kind: 'point', id: 'm', x: 50, y: 50 }]);

/** A horizontal line h at y = 25, its ends and midpoint far away. */
const LINE_AT_25 = data([
  { kind: 'point', id: 'h1', x: -200, y: 25 },
  { kind: 'point', id: 'h2', x: 300, y: 25 },
  { kind: 'line', id: 'h', p1: 'h1', p2: 'h2' },
]);

describe('the construction line tool', () => {
  it('two points make an xline, always construction; the tool stays for the next one', async () => {
    const { viewport, session, manager } = await drawing('sketch.xline');

    await clicks(viewport, [
      [10, 10],
      [40, 50],
    ]);

    const [p1, p2, line] = entitiesOf(session);
    expect(p1).toMatchObject({ kind: 'point', x: 10, y: 10 });
    expect(p2).toMatchObject({ kind: 'point', x: 40, y: 50 });
    expect(line).toMatchObject({ kind: 'xline', p1: p1?.id, p2: p2?.id, construction: true });
    expect(constraintsOf(session)).toEqual([]);
    expect(manager.active.get()).toBe('sketch.xline');

    await clicks(viewport, [
      [100, 10],
      [130, 50],
    ]);
    expect(added(session, 'xline')).toHaveLength(2);
  });

  it('a line within 3° of an axis gets it (automatic); with Ctrl/Cmd not', async () => {
    const first = await drawing('sketch.xline');
    await clicks(first.viewport, [
      [10, 10],
      [80, 13],
      [100, 100],
      [102, 170],
    ]);
    const [h, v] = added(first.session, 'xline');
    expect(constraintsOf(first.session)).toEqual([
      expect.objectContaining({ kind: 'horizontal', line: h?.id }),
      expect.objectContaining({ kind: 'vertical', line: v?.id }),
    ]);

    const second = await drawing('sketch.xline');
    await click(second.viewport, [10, 10], { mod: true });
    await click(second.viewport, [80, 13], { mod: true });
    expect(added(second.session, 'xline')).toHaveLength(1);
    expect(constraintsOf(second.session)).toEqual([]);
  });

  it('the axis is automatic: a conflict drops it and keeps the line', async () => {
    const { viewport, session, solver } = await drawing('sketch.xline');
    solver.next({ status: 'conflict', entities: null, conflicting: [] });

    await clicks(viewport, [
      [10, 10],
      [80, 13],
    ]);

    expect(added(session, 'xline')).toHaveLength(1);
    expect(constraintsOf(session)).toEqual([]);
  });

  it('points on existing points use their ids; an alignment with the first becomes the axis', async () => {
    const { viewport, session } = await drawing('sketch.xline', LONE_POINT);

    await clicks(viewport, [
      [51, 50],
      [90, 52],
    ]);

    const [line] = added(session, 'xline', LONE_POINT);
    expect(line?.p1).toBe('m');
    expect(xyOf(session, line?.p2 ?? '')).toEqual([90, 50]);
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'horizontal', line: line?.id }),
    ]);
  });

  it('a point on a curve gets pointOnCurve', async () => {
    const { viewport, session } = await drawing('sketch.xline', LINE_AT_25);

    await clicks(viewport, [
      [20, 26],
      [40, 70],
    ]);

    const [p1] = added(session, 'point', LINE_AT_25);
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'pointOnCurve', point: p1?.id, curve: 'h' }),
    ]);
  });

  it('a second point on the first makes nothing and the first stays', async () => {
    const { viewport, session, manager } = await drawing('sketch.xline');

    await clicks(viewport, [
      [10, 10],
      [10, 10],
    ]);
    expect(entitiesOf(session)).toEqual([]);
    expect(manager.active.get()).toBe('sketch.xline');

    await clicks(viewport, [[40, 50]]);
    const [line] = added(session, 'xline');
    expect(xyOf(session, line?.p1 ?? '')).toEqual([10, 10]);
  });

  it('Escape forgets the first point, a second Escape returns to sketch.select', async () => {
    const { viewport, session, manager } = await drawing('sketch.xline');
    await clicks(viewport, [[10, 10]]);
    move(viewport, [40, 50]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.xline');
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
    await clicks(viewport, [[40, 50]]);
    expect(entitiesOf(session)).toEqual([]);

    escape(viewport);
    expect(manager.active.get()).toBe('sketch.xline');
    escape(viewport);
    expect(manager.active.get()).toBe('sketch.select');
  });

  it('previews the line far beyond both points and its axis; a degenerate one is not drawn', async () => {
    const { viewport, session } = await drawing('sketch.xline');
    await clicks(viewport, [[10, 10]]);

    move(viewport, [80, 13]);
    const [shape] = viewport.overlayShapes.get('sketch-tool') ?? [];
    expect(shape?.style).toBe('preview');
    expect(shape?.points).toHaveLength(2);
    const [from, to] = shape?.points ?? [];
    expect(from?.[0]).toBeLessThan(-1e4);
    expect(to?.[0]).toBeGreaterThan(1e4);
    expect(inferenceOf(session)).toEqual({ anchor: [80, 13, 0], kinds: ['horizontal'] });

    move(viewport, [80, 13], { mod: true });
    expect(inferenceOf(session)).toBeNull();

    move(viewport, [10, 10]);
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
  });
});
