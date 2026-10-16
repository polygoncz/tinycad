import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Vec2 } from '@/core';
import { ORIGIN_PLANE_IDS, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, parseSketchData } from '@/sketch';
import type { SketchData, SketchEntity, TextOutliner } from '@/sketch';
import {
  createFakeSketchGeometry,
  createFakeSolver,
  createFakeTextOutliner,
  textData,
} from '@/sketch/testing';
import {
  SELECT_TOOL,
  createFeatureEditor,
  createSelectionModel,
  createToolManager,
  createToolRegistry,
} from '@/interaction';
import type {
  KeyMods,
  PickResult,
  SketchDrawing,
  ToolContext,
  ViewPointerEvent,
} from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import { createSketchEditor } from '@/sketcher/sketch-editor';
import type { SketchSession } from '@/sketcher/sketch-session';
import { createSketchTools } from '@/sketcher/sketch-tools';

// The Text tool of M37 (spec 12, "Text ve skice (M37)", "Nástroj Text"): sketch.text. An open new
// sketch on the plane XY with the tools of the sketcher, the FakeSolver, the fake TextOutliner
// (advance 0.6 · height per character, square letters) and the FakeViewport (in its default top
// view px = the local XY of the plane, 1 px = 1 mm). The pick of the fake finds the drawn points
// and lines (the select tool picks a letter).

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

/** Lets the outliner, the solver answers (microtasks) and the queue settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Pick radius in px of the fake: points first, then lines (like render). */
const PICK_RADIUS = 1;

function pickDrawings(viewport: FakeViewport, x: number, y: number): PickResult | null {
  const hit = (sketch: string, entity: string): PickResult => ({
    kind: 'sketchEntity',
    sketch,
    entity,
    point: [x, y, 0],
  });
  for (const [sketch, drawing] of viewport.sketchDrawings) {
    const point = drawing.points.find((p) => Math.hypot(p.at[0] - x, p.at[1] - y) <= PICK_RADIUS);
    if (point !== undefined) return hit(sketch, point.id);
  }
  for (const [sketch, drawing] of viewport.sketchDrawings) {
    const curve = drawing.curves.find((c) => lineDistance(c, x, y) <= PICK_RADIUS);
    if (curve !== undefined) return hit(sketch, curve.id);
  }
  return null;
}

function lineDistance(c: SketchDrawing['curves'][number], x: number, y: number): number {
  if (c.kind !== 'line') return Infinity;
  const [ax, ay] = c.from;
  const [bx, by] = c.to;
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
  return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
}

/** An open new sketch with `sketch` written into it and the tool `toolId` active. */
async function drawing(
  toolId: string,
  opts: { readonly sketch?: SketchData; readonly text?: TextOutliner } = {},
) {
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
  viewport.setPick((x, y) => pickDrawings(viewport, x, y));
  const solver = createFakeSolver();
  const sketches = createSketchEditor({
    features: editor,
    solver,
    geometry: createFakeSketchGeometry(),
    text: opts.text ?? createFakeTextOutliner(),
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
  manager.activate(toolId);
  return { viewport, manager, session, solver };
}

function pointer(type: ViewPointerEvent['type'], [x, y]: Vec2): ViewPointerEvent {
  return { type, x, y, button: type === 'move' ? null : 'left', mods: NO_MODS };
}

/** A click at the point (with the move before it) and the writes settled. */
async function click(viewport: FakeViewport, at: Vec2): Promise<void> {
  viewport.emitPointer(pointer('move', at));
  viewport.emitPointer(pointer('down', at));
  viewport.emitPointer(pointer('up', at));
  await settle();
}

const entitiesOf = (s: SketchSession): readonly SketchEntity[] => s.state.get().entities;

/** The entities of the session not in `before`. */
function added(s: SketchSession, before?: SketchData): readonly SketchEntity[] {
  const old = new Set(before?.entities.map((e) => e.id) ?? []);
  return entitiesOf(s).filter((e) => !old.has(e.id));
}

const fake = createFakeTextOutliner();
const DEFAULT = { text: 'Text', font: 'sans', height: 10 } as const;
/** 4 characters × 0.6 × 10 mm of the fake. */
const ADVANCE = 24;

/** A horizontal line h at y = 25, its ends and midpoint far away. */
const LINE_AT_25 = data([
  { kind: 'point', id: 'h1', x: -200, y: 25 },
  { kind: 'point', id: 'h2', x: 300, y: 25 },
  { kind: 'line', id: 'h', p1: 'h1', p2: 'h2' },
]);

describe('the Text tool', () => {
  it('shows its hint while active', async () => {
    const { manager } = await drawing('sketch.text');
    expect(manager.hint.get()).toEqual({ key: 'hint.text.place' });

    manager.activate('sketch.select');
    expect(manager.hint.get()).toBeNull();
  });

  it('a click writes a horizontal construction baseline of the advance and the text on it, selected', async () => {
    const { viewport, session, manager } = await drawing('sketch.text');

    await click(viewport, [20, 30]);

    const [p1, p2, line, text] = added(session);
    expect(p1).toMatchObject({ kind: 'point', x: 20, y: 30 });
    expect(p2).toMatchObject({ kind: 'point', x: 20 + ADVANCE, y: 30 });
    expect(line).toEqual({
      kind: 'line',
      id: line?.id,
      p1: p1?.id,
      p2: p2?.id,
      construction: true,
    });
    expect(text).toEqual({
      kind: 'text',
      id: text?.id,
      ...DEFAULT,
      baseline: line?.id,
      contours: await fake.outline(DEFAULT),
    });
    expect(added(session)).toHaveLength(4);
    expect(session.state.get().constraints).toEqual([]);
    expect(session.state.get().selection).toEqual([text?.id]);
    expect(manager.active.get()).toBe('sketch.text');
  });

  it('starts the baseline at an existing point under the click', async () => {
    const { viewport, session } = await drawing('sketch.text', { sketch: LINE_AT_25 });

    await click(viewport, [-200, 25]);

    const [p2, line] = added(session, LINE_AT_25);
    expect(line).toMatchObject({ kind: 'line', p1: 'h1', p2: p2?.id });
    expect(p2).toMatchObject({ kind: 'point', x: -200 + ADVANCE, y: 25 });
  });

  it('snaps the start onto a curve but writes no constraint', async () => {
    const { viewport, session } = await drawing('sketch.text', { sketch: LINE_AT_25 });

    await click(viewport, [20, 26]);

    const [p1] = added(session, LINE_AT_25);
    expect(p1).toMatchObject({ kind: 'point', x: 20, y: 25 });
    expect(session.state.get().constraints).toEqual([]);
  });

  it('in the construction mode the text is construction too', async () => {
    const { viewport, session } = await drawing('sketch.text');
    session.setConstructionMode(true);

    await click(viewport, [0, 50]);

    const text = added(session).find((e) => e.kind === 'text');
    expect(text).toMatchObject({ kind: 'text', construction: true });
  });

  it('an outliner that fails writes nothing', async () => {
    const failing: TextOutliner = {
      outline: () => Promise.reject(new Error('no font')),
      advance: () => Promise.reject(new Error('no font')),
    };
    const { viewport, session, solver } = await drawing('sketch.text', { text: failing });
    const calls = solver.calls.length;

    await click(viewport, [20, 30]);

    expect(added(session)).toEqual([]);
    expect(solver.calls).toHaveLength(calls);
  });

  it('Escape ends the tool', async () => {
    const { viewport, manager } = await drawing('sketch.text');

    viewport.emitKey({ key: 'Escape', mods: NO_MODS, inTextField: false });

    expect(manager.active.get()).toBe('sketch.select');
  });
});

describe('picking a text (M37)', () => {
  it('a click of the select tool on a letter selects the text', async () => {
    // The fake letter 'a' of the text 't' is a square from (0.5, 0) to (5.5, 5) on its baseline.
    const { viewport, session } = await drawing('sketch.select', { sketch: textData() });

    await click(viewport, [3, 5]);

    expect(session.state.get().selection).toEqual(['t']);
  });
});
