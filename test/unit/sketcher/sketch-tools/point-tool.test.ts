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

// The point tool of M31 (spec 12, "Nové kreslicí nástroje (M31)", "Nástroje"): sketch.point. An
// open new sketch on the plane XY with the tools of the sketcher, the FakeSolver and the
// FakeViewport (in its default top view px = the local XY of the plane, 1 px = 1 mm). The tool
// snaps through the snapper, so the fake needs no pick.

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

describe('the point tool', () => {
  it('a click makes a lone point and the tool stays for the next one', async () => {
    const { viewport, session, manager } = await drawing('sketch.point');

    await clicks(viewport, [
      [10, 20],
      [40, 70],
    ]);

    expect(entitiesOf(session)).toEqual([
      expect.objectContaining({ kind: 'point', x: 10, y: 20 }),
      expect.objectContaining({ kind: 'point', x: 40, y: 70 }),
    ]);
    expect(constraintsOf(session)).toEqual([]);
    expect(manager.active.get()).toBe('sketch.point');
  });

  it('a point on a curve gets pointOnCurve, the origin fix', async () => {
    const { viewport, session } = await drawing('sketch.point', LINE_AT_25);

    await clicks(viewport, [
      [20, 26],
      [0, 1],
    ]);

    const [onLine, atOrigin] = added(session, 'point', LINE_AT_25);
    expect(xyOf(session, onLine?.id ?? '')).toEqual([20, 25]);
    expect(xyOf(session, atOrigin?.id ?? '')).toEqual([0, 0]);
    expect(constraintsOf(session)).toEqual([
      expect.objectContaining({ kind: 'pointOnCurve', point: onLine?.id, curve: 'h' }),
      expect.objectContaining({ kind: 'fix', point: atOrigin?.id }),
    ]);
  });

  it('pointOnCurve is automatic: a conflict drops it and keeps the point', async () => {
    const { viewport, session, solver } = await drawing('sketch.point', LINE_AT_25);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });

    await clicks(viewport, [[20, 26]]);

    expect(added(session, 'point', LINE_AT_25)).toHaveLength(1);
    expect(constraintsOf(session)).toEqual([]);
  });

  it('with Ctrl/Cmd a point on a curve gets no constraint', async () => {
    const { viewport, session } = await drawing('sketch.point', LINE_AT_25);

    await click(viewport, [20, 26], { mod: true });

    expect(added(session, 'point', LINE_AT_25)).toHaveLength(1);
    expect(constraintsOf(session)).toEqual([]);
  });

  it('a click on an existing point makes nothing', async () => {
    const { viewport, session } = await drawing('sketch.point', LONE_POINT);

    await clicks(viewport, [[51, 50]]);

    expect(entitiesOf(session)).toEqual(LONE_POINT.entities);
  });

  it('Escape ends the tool', async () => {
    const { viewport, manager } = await drawing('sketch.point');
    move(viewport, [10, 20]);

    escape(viewport);

    expect(manager.active.get()).toBe('sketch.select');
  });

  it('previews pointOnCurve on a curve, nothing over an existing point; draws no shape', async () => {
    const { viewport, session } = await drawing(
      'sketch.point',
      data([...LONE_POINT.entities, ...LINE_AT_25.entities]),
    );

    move(viewport, [20, 26]);
    expect(inferenceOf(session)).toEqual({ anchor: [20, 25, 0], kinds: ['pointOnCurve'] });

    move(viewport, [51, 50]);
    expect(inferenceOf(session)).toBeNull();
    expect(viewport.overlayShapes.has('sketch-tool')).toBe(false);
  });
});

/** Types the keys into the view one by one. */
function type(viewport: FakeViewport, keys: readonly string[]): void {
  for (const key of keys) viewport.emitKey({ key, mods: NO_MODS, inTextField: false });
}

const chars = (text: string): readonly string[] => Array.from(text);

describe('the numeric input of the point tool (M32)', () => {
  it('X and Y from the keyboard place a point there, without constraints', async () => {
    const { viewport, session } = await drawing('sketch.point');
    move(viewport, [40, 40]);
    type(viewport, [...chars('12'), 'Tab', ...chars('-5'), 'Enter']);
    await settle();

    const [point] = added(session, 'point');
    expect(xyOf(session, point?.id ?? '')).toEqual([12, -5]);
    expect(constraintsOf(session)).toEqual([]);
  });

  it('a locked X with Y from the mouse; the point is not snapped onto an existing one', async () => {
    const { viewport, session } = await drawing('sketch.point', LONE_POINT);
    type(viewport, [...chars('50'), 'Tab']);
    await click(viewport, [49, 50]);

    const [point] = added(session, 'point', LONE_POINT);
    expect(xyOf(session, point?.id ?? '')).toEqual([50, 50]);
    expect(constraintsOf(session)).toEqual([]);
  });

  it('shows the fields x and y at the cursor', async () => {
    const { viewport, session } = await drawing('sketch.point');
    move(viewport, [3, 4]);
    expect(session.state.get().numericInput?.fields.map((f) => [f.id, f.text])).toEqual([
      ['x', '3.00'],
      ['y', '4.00'],
    ]);
  });
});
