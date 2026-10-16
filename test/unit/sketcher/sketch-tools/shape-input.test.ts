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

// The numeric input of the rectangles, the circle and the arc (spec 12, "Číselný vstup (M32)",
// "Pole a kóty podle nástrojů"): the fields of each step, the constrained point, the dimensions of
// the locked fields in the data (required) and a typed value as a preview only. An open new sketch
// on the plane XY with the FakeSolver and the FakeViewport (in its default top view px = the
// local XY of the plane, 1 px = 1 mm).

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
const DEG = Math.PI / 180;

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
  return { viewport, manager, session, solver };
}

function pointer(type: ViewPointerEvent['type'], [x, y]: Vec2): ViewPointerEvent {
  return { type, x, y, button: type === 'move' ? null : 'left', mods: NO_MODS };
}

function move(viewport: FakeViewport, at: Vec2): void {
  viewport.emitPointer(pointer('move', at));
}

/** A click at the point (with the move before it) and the writes settled. */
async function click(viewport: FakeViewport, at: Vec2): Promise<void> {
  move(viewport, at);
  viewport.emitPointer(pointer('down', at));
  viewport.emitPointer(pointer('up', at));
  await settle();
}

/** Types the keys into the view one by one and lets the writes settle. */
async function type(viewport: FakeViewport, keys: readonly string[]): Promise<void> {
  for (const key of keys) viewport.emitKey({ key, mods: NO_MODS, inTextField: false });
  await settle();
}

const chars = (text: string): readonly string[] => Array.from(text);

const entitiesOf = (s: SketchSession): readonly SketchEntity[] => s.state.get().entities;

/** The constraints of the session without their ids. */
const constraintsOf = (s: SketchSession) =>
  s.state.get().constraints.map((c): Omit<SketchConstraint, 'id'> & { id?: undefined } => ({
    ...c,
    id: undefined,
  }));

const kindsOf = (s: SketchSession): readonly string[] =>
  s.state.get().constraints.map((c) => c.kind);

/** The fields of the numeric input as [id, text]. */
const fieldsOf = (s: SketchSession) =>
  s.state.get().numericInput?.fields.map((f) => [f.id, f.text]) ?? null;

/** The anchor of the numeric input in the plane XY (the constrained cursor). */
function anchorOf(s: SketchSession): Vec2 | null {
  const anchor = s.state.get().numericInput?.anchor;
  return anchor === undefined ? null : [anchor[0], anchor[1]];
}

function entitiesOfKind<K extends SketchEntity['kind']>(
  s: SketchSession,
  kind: K,
): readonly Extract<SketchEntity, { kind: K }>[] {
  return entitiesOf(s).filter((e): e is Extract<SketchEntity, { kind: K }> => e.kind === kind);
}

function xyOf(s: SketchSession, id: string): Vec2 {
  const p = entitiesOf(s).find((e) => e.id === id);
  if (p?.kind !== 'point') throw new Error(`no point ${id}`);
  return [p.x, p.y];
}

function expectNear(actual: Vec2 | null, expected: Vec2): void {
  expect(actual?.[0]).toBeCloseTo(expected[0], 9);
  expect(actual?.[1]).toBeCloseTo(expected[1], 9);
}

/** The corners a, b, c, d of the four sides ab, bc, cd, da of the session. */
function cornersOf(s: SketchSession): readonly Vec2[] {
  const sides = entitiesOfKind(s, 'line').filter((l) => l.construction !== true);
  return sides.map((l) => xyOf(s, l.p1));
}

/** The ids of the points a, b, c of the sides ab, bc. */
function abc(s: SketchSession): readonly [string, string, string] {
  const [ab, bc] = entitiesOfKind(s, 'line');
  if (ab === undefined || bc === undefined) throw new Error('no sides');
  return [ab.p1, ab.p2, bc.p2];
}

describe('the numeric input of the rectangle tool (M32)', () => {
  it('shows x, y for the first corner and width, height for the second', async () => {
    const { viewport, session } = await drawing('sketch.rectangle');
    move(viewport, [30, 40]);
    expect(fieldsOf(session)).toEqual([
      ['x', '30.00'],
      ['y', '40.00'],
    ]);

    await click(viewport, [10, 10]);
    move(viewport, [50, 0]);
    expect(fieldsOf(session)).toEqual([
      ['width', '40.00'],
      ['height', '10.00'],
    ]);
  });

  it('40 × 20 from the keyboard: the corners and required distances of ab and bc', async () => {
    const { viewport, session } = await drawing('sketch.rectangle');
    move(viewport, [70, 50]);
    await type(viewport, [...chars('10'), 'Tab', ...chars('10'), 'Enter']);
    await type(viewport, [...chars('40'), 'Tab', ...chars('20'), 'Enter']);

    expect(cornersOf(session)).toEqual([
      [10, 10],
      [50, 10],
      [50, 30],
      [10, 30],
    ]);
    const [a, b, c] = abc(session);
    expect(constraintsOf(session).filter((k) => k.kind === 'distance')).toEqual([
      { kind: 'distance', id: undefined, a, b, value: 40 },
      { kind: 'distance', id: undefined, a: b, b: c, value: 20 },
    ]);
    expect(kindsOf(session)).toEqual([
      'horizontal',
      'vertical',
      'horizontal',
      'vertical',
      'distance',
      'distance',
    ]);
  });

  it('the sign of the width and the height follows the quadrant of the cursor', async () => {
    const { viewport, session } = await drawing('sketch.rectangle');
    await click(viewport, [10, 10]);
    move(viewport, [-20, -5]);
    await type(viewport, [...chars('40'), 'Tab', ...chars('20'), 'Enter']);

    expect(cornersOf(session)).toEqual([
      [10, 10],
      [-30, 10],
      [-30, -10],
      [10, -10],
    ]);
  });

  it('a locked width with the height from the mouse: only the width is a dimension', async () => {
    const { viewport, session } = await drawing('sketch.rectangle');
    await click(viewport, [10, 10]);
    await type(viewport, [...chars('40'), 'Tab']);
    await click(viewport, [90, 35]);

    expect(cornersOf(session)).toEqual([
      [10, 10],
      [50, 10],
      [50, 35],
      [10, 35],
    ]);
    const [a, b] = abc(session);
    expect(constraintsOf(session).filter((k) => k.kind === 'distance')).toEqual([
      { kind: 'distance', id: undefined, a, b, value: 40 },
    ]);
  });

  it('a typed width is a preview; a click takes only the locked values', async () => {
    const { viewport, session } = await drawing('sketch.rectangle');
    await click(viewport, [10, 10]);
    move(viewport, [70, 30]);
    await type(viewport, chars('40'));
    expect(anchorOf(session)).toEqual([50, 30]);

    await click(viewport, [70, 30]);
    expect(cornersOf(session)).toContainEqual([70, 30]);
    expect(kindsOf(session)).not.toContain('distance');
  });

  it('the dimensions are required: a conflict refuses the rectangle', async () => {
    const { viewport, session, solver } = await drawing('sketch.rectangle');
    await click(viewport, [10, 10]);
    move(viewport, [70, 50]);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });
    await type(viewport, [...chars('40'), 'Tab', ...chars('20'), 'Enter']);

    expect(entitiesOfKind(session, 'line')).toEqual([]);
  });
});

describe('the numeric input of the center rectangle tool (M32)', () => {
  it('shows x, y for the centre and the whole width, height for the corner', async () => {
    const { viewport, session } = await drawing('sketch.rectangleCenter');
    await click(viewport, [10, 10]);
    move(viewport, [30, 0]);
    expect(fieldsOf(session)).toEqual([
      ['width', '40.00'],
      ['height', '20.00'],
    ]);
  });

  it('40 × 20 around the centre: the corners and required distances of ab and bc', async () => {
    const { viewport, session, solver } = await drawing('sketch.rectangleCenter');
    await click(viewport, [10, 10]);
    move(viewport, [70, -50]);
    await type(viewport, [...chars('40'), 'Tab', ...chars('20'), 'Enter']);

    expect(cornersOf(session)).toEqual([
      [-10, 20],
      [30, 20],
      [30, 0],
      [-10, 0],
    ]);
    const [a, b, c] = abc(session);
    expect(constraintsOf(session).filter((k) => k.kind === 'distance')).toEqual([
      { kind: 'distance', id: undefined, a, b, value: 40 },
      { kind: 'distance', id: undefined, a: b, b: c, value: 20 },
    ]);

    // Required: a conflict refuses the next rectangle.
    await click(viewport, [200, 200]);
    move(viewport, [300, 300]);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });
    await type(viewport, [...chars('40'), 'Tab', ...chars('20'), 'Enter']);
    expect(entitiesOfKind(session, 'line')).toHaveLength(5);
  });

  it('a typed height is a preview; a click takes only the locked width', async () => {
    const { viewport, session } = await drawing('sketch.rectangleCenter');
    await click(viewport, [10, 10]);
    move(viewport, [40, 40]);
    await type(viewport, [...chars('40'), 'Tab', ...chars('10')]);
    expect(anchorOf(session)).toEqual([30, 15]);

    await click(viewport, [40, 40]);
    expect(cornersOf(session)).toContainEqual([30, 40]);
    expect(constraintsOf(session).filter((k) => k.kind === 'distance')).toHaveLength(1);
  });
});

describe('the numeric input of the 3-point rectangle tool (M32)', () => {
  it('shows x, y, then length, angle for the side, then height', async () => {
    const { viewport, session } = await drawing('sketch.rectangle3p');
    await click(viewport, [10, 10]);
    move(viewport, [10, 40]);
    expect(fieldsOf(session)).toEqual([
      ['length', '30.00'],
      ['angle', '90.00'],
    ]);

    await click(viewport, [50, 10]);
    move(viewport, [20, 35]);
    expect(fieldsOf(session)).toEqual([['height', '25.00']]);
  });

  it('40 × 20 under 0°: horizontal instead of the automatic axis and two distances', async () => {
    const { viewport, session } = await drawing('sketch.rectangle3p');
    await click(viewport, [10, 10]);
    move(viewport, [60, 40]);
    await type(viewport, [...chars('40'), 'Tab', '0', 'Enter']);
    await type(viewport, [...chars('20'), 'Enter']);

    expect(cornersOf(session)).toEqual([
      [10, 10],
      [50, 10],
      [50, 30],
      [10, 30],
    ]);
    const [ab] = entitiesOfKind(session, 'line');
    const [a, b, c] = abc(session);
    expect(constraintsOf(session).slice(3)).toEqual([
      { kind: 'horizontal', id: undefined, line: ab?.id },
      { kind: 'distance', id: undefined, a, b, value: 40 },
      { kind: 'distance', id: undefined, a: b, b: c, value: 20 },
    ]);
  });

  it('an angle off the axes has no dimension and drops the automatic axis', async () => {
    const { viewport, session } = await drawing('sketch.rectangle3p');
    await click(viewport, [10, 10]);
    // By the mouse the side would be horizontal (within 3°).
    move(viewport, [60, 11]);
    await type(viewport, ['Tab', '2', 'Enter']);
    await click(viewport, [0, 40]);

    const [a, b] = cornersOf(session);
    expect(a).toEqual([10, 10]);
    const t = 50 * Math.cos(2 * DEG) + 1 * Math.sin(2 * DEG);
    expectNear(b ?? null, [10 + t * Math.cos(2 * DEG), 10 + t * Math.sin(2 * DEG)]);
    expect(kindsOf(session)).toEqual(['perpendicular', 'parallel', 'parallel']);
  });

  it('the height goes to the side of the cursor', async () => {
    const { viewport, session } = await drawing('sketch.rectangle3p');
    await click(viewport, [10, 10]);
    await click(viewport, [50, 10]);
    move(viewport, [30, -40]);
    await type(viewport, [...chars('20'), 'Enter']);

    expect(cornersOf(session)).toEqual([
      [10, 10],
      [50, 10],
      [50, -10],
      [10, -10],
    ]);
    const [, b, c] = abc(session);
    expect(constraintsOf(session).filter((k) => k.kind === 'distance')).toEqual([
      { kind: 'distance', id: undefined, a: b, b: c, value: 20 },
    ]);
  });

  it('a typed height is a preview; the click takes the cursor', async () => {
    const { viewport, session } = await drawing('sketch.rectangle3p');
    await click(viewport, [10, 10]);
    await click(viewport, [50, 10]);
    move(viewport, [30, 40]);
    await type(viewport, chars('20'));
    expect(anchorOf(session)).toEqual([50, 30]);

    await click(viewport, [30, 40]);
    expect(cornersOf(session)).toContainEqual([50, 40]);
    expect(kindsOf(session)).not.toContain('distance');
  });

  it('the typed constraints are required: a conflict refuses the rectangle', async () => {
    const { viewport, session, solver } = await drawing('sketch.rectangle3p');
    await click(viewport, [10, 10]);
    move(viewport, [60, 40]);
    await type(viewport, [...chars('40'), 'Tab', '0', 'Enter']);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });
    await type(viewport, [...chars('20'), 'Enter']);

    expect(entitiesOfKind(session, 'line')).toEqual([]);
  });
});

/** A circle of radius 15 around (100, 100): the last round of inferRadius. */
const CIRCLE_15 = data([
  { kind: 'point', id: 'o', x: 100, y: 100 },
  { kind: 'circle', id: 'k', center: 'o', radius: 15 },
]);

describe('the numeric input of the circle tool (M32)', () => {
  it('shows x, y for the centre and the diameter for the rim', async () => {
    const { viewport, session } = await drawing('sketch.circle');
    move(viewport, [5, 6]);
    expect(fieldsOf(session)).toEqual([
      ['x', '5.00'],
      ['y', '6.00'],
    ]);

    await click(viewport, [10, 10]);
    move(viewport, [13, 14]);
    expect(fieldsOf(session)).toEqual([['diameter', '10.00']]);
  });

  it('⌀ 30 from the keyboard: radius 15 and a required diameter instead of equal', async () => {
    const { viewport, session, solver } = await drawing('sketch.circle', CIRCLE_15);
    move(viewport, [40, 10]);
    await type(viewport, [...chars('10'), 'Tab', ...chars('10'), 'Enter']);
    await type(viewport, [...chars('30'), 'Enter']);

    const circle = entitiesOfKind(session, 'circle')[1];
    if (circle === undefined) throw new Error('no circle');
    expect(xyOf(session, circle.center)).toEqual([10, 10]);
    expect(circle.radius).toBe(15);
    expect(constraintsOf(session)).toEqual([
      { kind: 'diameter', id: undefined, curve: circle.id, value: 30 },
    ]);

    // Required: a conflict refuses the next circle.
    await click(viewport, [200, 200]);
    move(viewport, [250, 200]);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });
    await type(viewport, [...chars('30'), 'Enter']);
    expect(entitiesOfKind(session, 'circle')).toHaveLength(2);
  });

  it('without the input a circle of the same radius is equal to the last one', async () => {
    const { viewport, session } = await drawing('sketch.circle', CIRCLE_15);
    await click(viewport, [10, 10]);
    await click(viewport, [25, 10]);

    expect(kindsOf(session)).toEqual(['equal']);
  });

  it('a typed diameter is a preview in the direction of the cursor; the click takes the cursor', async () => {
    const { viewport, session } = await drawing('sketch.circle');
    await click(viewport, [10, 10]);
    move(viewport, [10, 50]);
    await type(viewport, chars('30'));
    expect(anchorOf(session)).toEqual([10, 25]);

    await click(viewport, [10, 50]);
    expect(entitiesOfKind(session, 'circle')[0]?.radius).toBe(40);
    expect(kindsOf(session)).toEqual([]);
  });
});

describe('the numeric input of the arc tool (M32)', () => {
  it('shows x, y, then radius, angle for the start, then the sweep', async () => {
    const { viewport, session } = await drawing('sketch.arc');
    await click(viewport, [10, 10]);
    move(viewport, [10, 30]);
    expect(fieldsOf(session)).toEqual([
      ['radius', '20.00'],
      ['angle', '90.00'],
    ]);

    await click(viewport, [10, 30]);
    move(viewport, [-10, 10]);
    expect(fieldsOf(session)).toEqual([['sweep', '90.00']]);
  });

  it('R 10 from 90° by 90°: the points and a required radius, the angles without one', async () => {
    const { viewport, session, solver } = await drawing('sketch.arc', CIRCLE_15);
    await click(viewport, [10, 10]);
    move(viewport, [40, 10]);
    await type(viewport, [...chars('10'), 'Tab', ...chars('90'), 'Enter']);
    await type(viewport, [...chars('90'), 'Enter']);

    const [arc] = entitiesOfKind(session, 'arc');
    if (arc === undefined) throw new Error('no arc');
    expect(xyOf(session, arc.center)).toEqual([10, 10]);
    expectNear(xyOf(session, arc.start), [10, 20]);
    expectNear(xyOf(session, arc.end), [0, 10]);
    expect(constraintsOf(session)).toEqual([
      { kind: 'radius', id: undefined, curve: arc.id, value: 10 },
    ]);

    // Required: a conflict refuses the next arc.
    await click(viewport, [200, 200]);
    move(viewport, [230, 200]);
    await type(viewport, [...chars('10'), 'Enter']);
    solver.next({ status: 'conflict', entities: null, conflicting: [] });
    await click(viewport, [200, 300]);
    expect(entitiesOfKind(session, 'arc')).toHaveLength(1);
  });

  it('a locked radius drops the automatic equal', async () => {
    const { viewport, session } = await drawing('sketch.arc', CIRCLE_15);
    await click(viewport, [10, 10]);
    move(viewport, [40, 10]);
    await type(viewport, [...chars('15'), 'Tab']);
    await click(viewport, [40, 10]);
    await click(viewport, [10, 40]);

    expect(kindsOf(session)).toEqual(['radius']);
  });

  it('a sweep of 0 or less is a degenerate step; the arc waits for its end', async () => {
    const { viewport, session } = await drawing('sketch.arc');
    await click(viewport, [10, 10]);
    await click(viewport, [20, 10]);
    await type(viewport, ['-', ...chars('30'), 'Enter']);
    expect(entitiesOfKind(session, 'arc')).toEqual([]);

    await click(viewport, [10, 40]);
    expect(entitiesOfKind(session, 'arc')).toHaveLength(1);
  });

  it('a typed sweep is a preview; the click takes the cursor', async () => {
    const { viewport, session } = await drawing('sketch.arc');
    await click(viewport, [10, 10]);
    await click(viewport, [20, 10]);
    move(viewport, [10, -30]);
    await type(viewport, chars('90'));
    expectNear(anchorOf(session), [10, 20]);

    await click(viewport, [10, -30]);
    const [arc] = entitiesOfKind(session, 'arc');
    if (arc === undefined) throw new Error('no arc');
    expectNear(xyOf(session, arc.end), [10, 0]);
  });
});
