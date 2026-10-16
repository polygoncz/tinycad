import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Vec2 } from '@/core';
import { ORIGIN_PLANE_IDS, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE, isPattern, parseSketchData } from '@/sketch';
import type { SketchData, SketchEntityId, SketchPattern } from '@/sketch';
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
import type {
  KeyMods,
  PickResult,
  SketchDrawing,
  ToolContext,
  ToolManager,
  ViewPointerEvent,
} from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import { createSketchEditor } from '@/sketcher/sketch-editor';
import type { SketchSession } from '@/sketcher/sketch-session';
import { createSketchTools } from '@/sketcher/sketch-tools';

// The mirror and pattern tools (spec 12, "Zrcadlení a pole (M36)", "Nástroje"): sources → Enter →
// the axis or the centre. In the default top view of FakeViewport px = the local XY of the plane XY.

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

// Test ids are trusted.
const eid = (id: string): SketchEntityId => id as SketchEntityId;

/**
 * The line pq (10,10)–(40,10), the circle k around c (100,100) of radius 20, the vertical line ab
 * (60,0)–(60,80), the lone points m (70,50) and o (150,10), and a mirror mm of pq across ab.
 */
const SKETCH = data(
  [
    { kind: 'point', id: 'p', x: 10, y: 10 },
    { kind: 'point', id: 'q', x: 40, y: 10 },
    { kind: 'line', id: 'pq', p1: 'p', p2: 'q' },
    { kind: 'point', id: 'c', x: 100, y: 100 },
    { kind: 'circle', id: 'k', center: 'c', radius: 20 },
    { kind: 'point', id: 'a', x: 60, y: 0 },
    { kind: 'point', id: 'b', x: 60, y: 80 },
    { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
    { kind: 'point', id: 'm', x: 70, y: 50 },
    { kind: 'point', id: 'o', x: 150, y: 10 },
    { kind: 'mirror', id: 'mm', sources: ['pq'], axis: 'ab' },
  ],
  [{ kind: 'horizontal', id: 'h', line: 'pq' }],
);

/** Points on pq, k, ab and the copy of pq; the points m and o. */
const ON_PQ: Vec2 = [25, 10];
const ON_K: Vec2 = [120, 100];
const ON_AB: Vec2 = [60, 40];
const ON_COPY: Vec2 = [95, 10];
const AT_M: Vec2 = [70, 50];
const AT_O: Vec2 = [150, 10];
const AT_C: Vec2 = [100, 100];

/** Pick radius in px of the fake: points first, then curves (like render). */
const PICK_RADIUS = 1;

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
    return Math.min(
      ...c.points.slice(1).map((to, i) => segmentDistance(c.points[i] ?? to, to, x, y)),
    );
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

type PatternToolId = 'sketch.mirror' | 'sketch.linearPattern' | 'sketch.circularPattern';

/** An open sketch with `sketch`, `preselect` selected, then the tool `tool` active. */
async function patterning(
  tool: PatternToolId,
  opts: { readonly preselect?: readonly string[]; readonly sketch?: SketchData } = {},
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
    text: createFakeTextOutliner(),
    viewport,
    resolvePlane: () => ({ origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] }),
    planeOfSketch: () => undefined,
  });
  const registry = createToolRegistry();
  registry.register(SELECT_TOOL);
  for (const t of createSketchTools({ sketches })) registry.register(t);
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
  await session.addGeometry(opts.sketch ?? SKETCH);
  await settle();
  for (const id of opts.preselect ?? []) session.select(eid(id), { additive: true });
  manager.activate(tool);
  return { viewport, manager, session, solver };
}

/** Lets the solver answers (microtasks) and the queue settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function pointer(type: ViewPointerEvent['type'], x: number, y: number): ViewPointerEvent {
  return { type, x, y, button: type === 'move' ? null : 'left', mods: NO_MODS };
}

/** A click at the point (with the move before it) and the writes settled. */
async function click(viewport: FakeViewport, [x, y]: Vec2): Promise<void> {
  viewport.emitPointer(pointer('move', x, y));
  viewport.emitPointer(pointer('down', x, y));
  viewport.emitPointer(pointer('up', x, y));
  await settle();
}

async function key(viewport: FakeViewport, name: 'Enter' | 'Escape'): Promise<void> {
  viewport.emitKey({ key: name, mods: NO_MODS, inTextField: false });
  await settle();
}

const selectionOf = (s: SketchSession): readonly string[] => s.state.get().selection;
/** The patterns of the session other than the mirror mm of the fixture. */
const newPatternsOf = (s: SketchSession): readonly SketchPattern[] =>
  s.state.get().entities.filter((e): e is SketchPattern => isPattern(e) && e.id !== 'mm');

describe('the pattern tools: sources', () => {
  it('take the preselected points and curves; patterns and constraints leave the selection', async () => {
    const { session } = await patterning('sketch.mirror', {
      preselect: ['pq', 'h', 'mm', 'm'],
    });
    expect(selectionOf(session)).toEqual(['pq', 'm']);
  });

  it('a click toggles a source; a copy, a pattern and an empty place are no source', async () => {
    const { viewport, session } = await patterning('sketch.mirror');

    await click(viewport, ON_PQ);
    await click(viewport, AT_M);
    await click(viewport, ON_COPY);
    await click(viewport, [200, 200]);
    expect(selectionOf(session)).toEqual(['pq', 'm']);

    await click(viewport, ON_PQ);
    expect(selectionOf(session)).toEqual(['m']);
  });

  it('Enter without sources does nothing: a line click is still a source', async () => {
    const { viewport, session, solver } = await patterning('sketch.mirror');
    const calls = solver.calls.length;

    await key(viewport, 'Enter');
    await click(viewport, ON_AB);

    expect(solver.calls).toHaveLength(calls);
    expect(newPatternsOf(session)).toEqual([]);
    expect(selectionOf(session)).toEqual(['ab']);
  });

  it('Escape among sources clears them, then ends the tool', async () => {
    const { viewport, session, manager } = await patterning('sketch.mirror', {
      preselect: ['pq'],
    });

    await key(viewport, 'Escape');
    expect(selectionOf(session)).toEqual([]);
    expect(manager.active.get()).toBe('sketch.mirror');

    await key(viewport, 'Escape');
    expect(manager.active.get()).toBe('sketch.select');
  });
});

describe('the mirror tool', () => {
  it('sources → Enter → a click on a line writes the mirror, selected; the tool starts again', async () => {
    const { viewport, session, manager } = await patterning('sketch.mirror', {
      preselect: ['pq', 'k'],
    });

    await key(viewport, 'Enter');
    await click(viewport, ON_AB);

    const [mirror] = newPatternsOf(session);
    expect(newPatternsOf(session)).toHaveLength(1);
    expect(mirror).toEqual({ kind: 'mirror', id: mirror?.id, sources: ['pq', 'k'], axis: 'ab' });
    expect(session.state.get().constraints.map((c) => c.id)).toEqual(['h']);
    expect(selectionOf(session)).toEqual([mirror?.id]);
    expect(manager.active.get()).toBe('sketch.mirror');

    // Started again: a click on a line is a source, not an axis.
    await click(viewport, ON_PQ);
    expect(selectionOf(session)).toEqual(['pq']);
    expect(newPatternsOf(session)).toHaveLength(1);
  });

  it('takes an xline as the axis (after M31)', async () => {
    // The vertical xline x = 150 through o and u, clicked far from both points.
    const sketch = data(
      [
        ...SKETCH.entities,
        { kind: 'point', id: 'u', x: 150, y: 60 },
        { kind: 'xline', id: 'xl', p1: 'o', p2: 'u', construction: true },
      ],
      SKETCH.constraints,
    );
    const { viewport, session } = await patterning('sketch.mirror', {
      preselect: ['pq'],
      sketch,
    });

    await key(viewport, 'Enter');
    await click(viewport, [150, 200]);

    const [mirror] = newPatternsOf(session);
    expect(mirror).toEqual({ kind: 'mirror', id: mirror?.id, sources: ['pq'], axis: 'xl' });
  });

  it('in the axis step a point, a circle, a source line or nothing write nothing', async () => {
    const { viewport, session, solver } = await patterning('sketch.mirror', {
      preselect: ['pq'],
    });
    await key(viewport, 'Enter');
    const calls = solver.calls.length;

    await click(viewport, AT_M);
    await click(viewport, ON_K);
    await click(viewport, ON_PQ);
    await click(viewport, [200, 200]);

    expect(solver.calls).toHaveLength(calls);
    expect(newPatternsOf(session)).toEqual([]);
    expect(selectionOf(session)).toEqual(['pq']);
  });

  it('Escape in the axis step goes back to the sources', async () => {
    const { viewport, session, manager } = await patterning('sketch.mirror', {
      preselect: ['pq'],
    });
    await key(viewport, 'Enter');

    await key(viewport, 'Escape');
    expect(selectionOf(session)).toEqual(['pq']);
    expect(manager.active.get()).toBe('sketch.mirror');

    // Among the sources again: a line click toggles a source.
    await click(viewport, ON_AB);
    expect(selectionOf(session)).toEqual(['pq', 'ab']);
    expect(newPatternsOf(session)).toEqual([]);
  });
});

describe('the circular pattern tool', () => {
  it('a click on a point writes count 4 over 2π, selected with its dimensions', async () => {
    const { viewport, session } = await patterning('sketch.circularPattern', {
      preselect: ['pq'],
    });

    await key(viewport, 'Enter');
    await click(viewport, AT_O);

    const [pattern] = newPatternsOf(session);
    expect(pattern).toEqual({
      kind: 'circularPattern',
      id: pattern?.id,
      sources: ['pq'],
      center: 'o',
      count: 4,
      angle: 2 * Math.PI,
    });
    expect(selectionOf(session)).toEqual([pattern?.id]);
    expect(session.state.get().patternDimensions.map((v) => v.param)).toEqual(['count', 'angle']);
  });

  it('in the centre step a line, a source point or nothing write nothing', async () => {
    const { viewport, session } = await patterning('sketch.circularPattern', {
      preselect: ['k', 'm'],
    });
    await key(viewport, 'Enter');

    await click(viewport, ON_AB);
    await click(viewport, AT_M);
    await click(viewport, [200, 200]);
    expect(newPatternsOf(session)).toEqual([]);

    // The centre of a source circle is a point of the sketch, not a source.
    await click(viewport, AT_C);
    expect(newPatternsOf(session)).toMatchObject([{ sources: ['k', 'm'], center: 'c' }]);
  });
});

describe('the linear pattern tool', () => {
  it('Enter writes 3 instances along x at 1.5 × the width of the sources, selected', async () => {
    const { viewport, session, manager } = await patterning('sketch.linearPattern', {
      preselect: ['pq'],
    });

    await key(viewport, 'Enter');

    const [pattern] = newPatternsOf(session);
    expect(pattern).toEqual({
      kind: 'linearPattern',
      id: pattern?.id,
      sources: ['pq'],
      direction1: { angle: 0, count: 3, spacing: 45 },
    });
    expect(selectionOf(session)).toEqual([pattern?.id]);
    expect(session.state.get().patternDimensions.map((v) => v.param)).toEqual([
      'count1',
      'spacing1',
      'angle1',
      'count2',
    ]);
    expect(manager.active.get()).toBe('sketch.linearPattern');
  });

  it('the width of a circle counts with its radius', async () => {
    const { viewport, session } = await patterning('sketch.linearPattern', {
      preselect: ['k', 'm'],
    });
    await key(viewport, 'Enter');
    // x from 70 (m) to 120 (k): 50.
    expect(newPatternsOf(session)).toMatchObject([{ direction1: { spacing: 75 } }]);
  });

  it('sources without width take a spacing of 10 mm', async () => {
    const { viewport, session } = await patterning('sketch.linearPattern', {
      preselect: ['ab'],
    });
    await key(viewport, 'Enter');
    expect(newPatternsOf(session)).toMatchObject([
      { sources: ['ab'], direction1: { angle: 0, count: 3, spacing: 10 } },
    ]);
  });

  it('a second Enter after the write starts no new pattern without new sources', async () => {
    const { viewport, session } = await patterning('sketch.linearPattern', {
      preselect: ['pq'],
    });
    await key(viewport, 'Enter');
    await key(viewport, 'Enter');
    expect(newPatternsOf(session)).toHaveLength(1);
  });
});

describe('the pattern tools: the hint HUD (M37)', () => {
  const hintOf = (manager: ToolManager): string | null => manager.hint.get()?.key ?? null;

  it('mirror: sources → axis → done; Escape in the axis step and a source click go back', async () => {
    const { viewport, manager } = await patterning('sketch.mirror', { preselect: ['pq'] });
    expect(hintOf(manager)).toBe('hint.mirror.sources');

    await key(viewport, 'Enter');
    expect(hintOf(manager)).toBe('hint.mirror.axis');
    await key(viewport, 'Escape');
    expect(hintOf(manager)).toBe('hint.mirror.sources');

    await key(viewport, 'Enter');
    await click(viewport, ON_AB);
    expect(hintOf(manager)).toBe('hint.mirror.done');

    await click(viewport, ON_PQ);
    expect(hintOf(manager)).toBe('hint.mirror.sources');
  });

  it('a click that writes nothing in the axis step keeps the hint', async () => {
    const { viewport, manager } = await patterning('sketch.mirror', { preselect: ['pq'] });
    await key(viewport, 'Enter');
    await click(viewport, AT_M);
    expect(hintOf(manager)).toBe('hint.mirror.axis');
  });

  it('Enter without sources keeps the sources hint', async () => {
    const { viewport, manager } = await patterning('sketch.circularPattern');
    await key(viewport, 'Enter');
    expect(hintOf(manager)).toBe('hint.circularPattern.sources');
  });

  it('circular: sources → centre → edit; Escape after the write goes back to the sources', async () => {
    const { viewport, manager } = await patterning('sketch.circularPattern', {
      preselect: ['pq'],
    });
    expect(hintOf(manager)).toBe('hint.circularPattern.sources');

    await key(viewport, 'Enter');
    expect(hintOf(manager)).toBe('hint.circularPattern.center');
    await click(viewport, AT_O);
    expect(hintOf(manager)).toBe('hint.pattern.edit');

    await key(viewport, 'Escape');
    expect(hintOf(manager)).toBe('hint.circularPattern.sources');
  });

  it('linear: sources → edit at once; a source click goes back to the sources', async () => {
    const { viewport, manager } = await patterning('sketch.linearPattern', { preselect: ['pq'] });
    expect(hintOf(manager)).toBe('hint.linearPattern.sources');

    await key(viewport, 'Enter');
    expect(hintOf(manager)).toBe('hint.pattern.edit');

    await click(viewport, ON_K);
    expect(hintOf(manager)).toBe('hint.linearPattern.sources');
  });

  it('the hint goes when the tool ends', async () => {
    const { viewport, manager } = await patterning('sketch.mirror');
    await key(viewport, 'Escape');
    expect(manager.active.get()).toBe('sketch.select');
    expect(manager.hint.get()).toBeNull();
  });
});
