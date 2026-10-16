import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { Vec2 } from '@/core';
import { ORIGIN_PLANE_IDS, createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { SKETCH_FEATURE_TYPE } from '@/sketch';
import { createFakeSketchGeometry, createFakeSolver } from '@/sketch/testing';
import {
  SELECT_TOOL,
  createFeatureEditor,
  createSelectionModel,
  createToolManager,
  createToolRegistry,
} from '@/interaction';
import type { KeyMods, ToolContext, ViewKeyEvent, ViewPointerEvent } from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import type { InputField } from '@/sketcher/numeric-input';
import { createSketchEditor } from '@/sketcher/sketch-editor';
import type { SketchSession } from '@/sketcher/sketch-session';
import { createSketchTools } from '@/sketcher/sketch-tools';
import {
  POLAR_FIELDS,
  XY_FIELDS,
  axisOfAngle,
  clickTool,
  constrainPolar,
  constrainXY,
  measurePolar,
  withoutLocked,
} from '@/sketcher/sketch-tools/common';
import type { ClickHandlers, ToolMods } from '@/sketcher/sketch-tools/common';
import { freeTarget, snapAt } from '@/sketcher/sketch-tools/snap';

// clickTool and the numeric input (spec 12, "Číselný vstup (M32)", "Napojení na nástroje"): a
// tool of recording handlers over an open sketch on the plane XY; in the default top view of
// FakeViewport px = the local XY of the plane. The tool is driven directly, not through the
// ToolManager (which keeps its own active tool).

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

function expectNear(actual: Vec2 | undefined, expected: Vec2): void {
  expect(actual?.[0]).toBeCloseTo(expected[0], 9);
  expect(actual?.[1]).toBeCloseTo(expected[1], 9);
}

/** An open new sketch and its tool context. */
async function sketching() {
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
  const sketches = createSketchEditor({
    features: editor,
    solver: createFakeSolver(),
    geometry: createFakeSketchGeometry(),
    viewport,
    resolvePlane: () => ({ origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] }),
    planeOfSketch: () => undefined,
  });
  const registry = createToolRegistry();
  registry.register(SELECT_TOOL);
  for (const tool of createSketchTools({ sketches })) registry.register(tool);
  const ctx: ToolContext = {
    viewport,
    selection: createSelectionModel({ regen: new FakeRegenStatus() }),
    doc: ops.doc,
    ids: createSequentialIdGenerator('t'),
    features: editor,
    finish: () => undefined,
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { sketches, session, ctx, viewport };
}

interface Call {
  readonly name: 'move' | 'click' | 'key';
  readonly at?: Vec2;
  readonly input?: ToolMods['input'];
  readonly key?: string;
}

/**
 * A tool of handlers that record their calls: the steps alternate between the polar fields from
 * the origin (step 0) and the fields x, y (step 1); a click goes to the next step, Escape resets.
 * `onKey` handles Escape and the letter q.
 */
async function aTool(opts: { fields?: (step: number) => readonly InputField[] } = {}) {
  const s = await sketching();
  const calls: Call[] = [];
  let step = 0;
  let asked = 0;
  const fieldsOf = opts.fields ?? ((n: number) => (n % 2 === 0 ? POLAR_FIELDS : XY_FIELDS));
  const handlers: ClickHandlers = {
    reset() {
      step = 0;
    },
    inputFields() {
      asked += 1;
      return fieldsOf(step);
    },
    constrain(_session, cursor, values) {
      return step % 2 === 0 ? constrainPolar([0, 0], cursor, values) : constrainXY(cursor, values);
    },
    measure(_session, at) {
      return step % 2 === 0
        ? measurePolar([0, 0], at)
        : new Map([
            ['x', at[0]],
            ['y', at[1]],
          ]);
    },
    onMove(_ctx, _session, x, y, mods) {
      calls.push({ name: 'move', at: [x, y], ...(mods.input ? { input: mods.input } : {}) });
    },
    onClick(_ctx, _session, x, y, mods) {
      calls.push({ name: 'click', at: [x, y], ...(mods.input ? { input: mods.input } : {}) });
      step += 1;
    },
    onKey(_ctx, _session, e) {
      calls.push({ name: 'key', key: e.key });
      if (e.key === 'Escape') {
        step = 0;
        return true;
      }
      return e.key === 'q';
    },
  };
  const tool = clickTool(s.sketches, handlers);
  tool.activate(s.ctx);
  const pointer = (type: ViewPointerEvent['type'], x: number, y: number): void => {
    tool.onPointer?.({
      type,
      x,
      y,
      button: type === 'move' || type === 'leave' ? null : 'left',
      mods: NO_MODS,
    });
  };
  return {
    ...s,
    tool,
    calls,
    asked: () => asked,
    move: (x: number, y: number) => {
      pointer('move', x, y);
    },
    click: (x: number, y: number) => {
      pointer('move', x, y);
      pointer('down', x, y);
      pointer('up', x, y);
    },
    leave: () => {
      pointer('leave', 0, 0);
    },
    key: (k: string, mods: Partial<KeyMods> = {}): boolean => {
      const e: ViewKeyEvent = { key: k, mods: { ...NO_MODS, ...mods }, inTextField: false };
      return tool.onKey?.(e) ?? false;
    },
  };
}

const keys = (t: { key: (k: string) => boolean }, text: string): void => {
  for (const k of Array.from(text)) t.key(k);
};

const numericOf = (s: SketchSession) => s.state.get().numericInput;
const textsOf = (s: SketchSession) => numericOf(s)?.fields.map((f) => f.text);

describe('clickTool and the numeric input (M32)', () => {
  it('a key goes to the input first: a digit is spent there, a letter goes on to the tool', async () => {
    const t = await aTool();
    t.move(30, 40);

    expect(t.key('5')).toBe(true);
    expect(t.key('q')).toBe(true);
    expect(t.key('w')).toBe(false);

    expect(t.calls.filter((c) => c.name === 'key').map((c) => c.key)).toEqual(['q', 'w']);
  });

  it('shows the fields at the cursor with the measured values', async () => {
    const t = await aTool();
    t.move(30, 40);

    expect(numericOf(t.session)).toEqual({
      anchor: [30, 40, 0],
      fields: [
        expect.objectContaining({ id: 'length', text: '50.00', typed: false, active: true }),
        expect.objectContaining({ id: 'angle', text: '53.13', typed: false, active: false }),
      ],
    });
  });

  it('a typed value previews: the move gets the constrained point, no snapper', async () => {
    const t = await aTool();
    t.move(30, 40);
    keys(t, '10');

    // Typing previews again at the last cursor.
    const last = t.calls.at(-1);
    expect(last?.name).toBe('move');
    expectNear(last?.input?.at, [6, 8]);
    expect(last?.input?.values).toEqual(new Map([['length', 10]]));
    const anchor = numericOf(t.session)?.anchor;
    expectNear(anchor === undefined ? undefined : [anchor[0], anchor[1]], [6, 8]);
    expect(textsOf(t.session)).toEqual(['10', '53.13']);

    t.move(0, 20);
    expectNear(t.calls.at(-1)?.input?.at, [0, 10]);
  });

  it('a click takes only the locked values: a typed one is dropped', async () => {
    const t = await aTool();
    keys(t, '10');
    t.click(30, 40);

    const click = t.calls.find((c) => c.name === 'click');
    expect(click?.at).toEqual([30, 40]);
    expect(click?.input).toBeUndefined();
  });

  it('Tab locks the value: a click gets the constrained point', async () => {
    const t = await aTool();
    keys(t, '10');
    t.key('Tab');
    t.click(30, 40);

    const click = t.calls.find((c) => c.name === 'click');
    expectNear(click?.input?.at, [6, 8]);
    expect(click?.input?.values).toEqual(new Map([['length', 10]]));
  });

  it('Enter clicks at the last cursor with the locked values', async () => {
    const t = await aTool();
    t.move(30, 40);
    keys(t, '10');
    t.key('Tab');
    keys(t, '90');

    expect(t.key('Enter')).toBe(true);

    const click = t.calls.find((c) => c.name === 'click');
    expect(click?.at).toEqual([30, 40]);
    expectNear(click?.input?.at, [0, 10]);
  });

  it('Enter without a cursor only locks the value', async () => {
    const t = await aTool();
    keys(t, '10');

    expect(t.key('Enter')).toBe(true);
    expect(t.calls.some((c) => c.name === 'click')).toBe(false);

    t.move(30, 40);
    expect(numericOf(t.session)?.fields[0]).toMatchObject({ text: '10', locked: true });
  });

  it('a step asks the fields again and empties the input', async () => {
    const t = await aTool();
    keys(t, '10');
    t.key('Tab');
    const asked = t.asked();
    t.click(30, 40);

    expect(t.asked()).toBeGreaterThan(asked);
    expect(numericOf(t.session)?.fields.map((f) => f.id)).toEqual(['x', 'y']);
    expect(textsOf(t.session)).toEqual(['30.00', '40.00']);
    expect(numericOf(t.session)?.fields.every((f) => !f.typed && !f.locked)).toBe(true);
  });

  it('Escape with a typed value empties the input and does not reach the tool', async () => {
    const t = await aTool();
    t.move(30, 40);
    keys(t, '10');

    expect(t.key('Escape')).toBe(true);

    expect(t.calls.some((c) => c.name === 'key')).toBe(false);
    expect(textsOf(t.session)).toEqual(['50.00', '53.13']);
    expect(t.calls.at(-1)?.input).toBeUndefined();
  });

  it('Escape without a value goes to the tool; handled, it asks the fields again', async () => {
    const t = await aTool();
    t.click(30, 40);
    t.move(1, 2);
    expect(numericOf(t.session)?.fields.map((f) => f.id)).toEqual(['x', 'y']);

    expect(t.key('Escape')).toBe(true);

    expect(t.calls.at(-1)).toEqual({ name: 'key', key: 'Escape' });
    expect(numericOf(t.session)?.fields.map((f) => f.id)).toEqual(['length', 'angle']);
  });

  it('a step without fields shows no input and leaves every key to the tool', async () => {
    const t = await aTool({ fields: () => [] });
    t.move(30, 40);

    expect(t.key('5')).toBe(false);
    expect(numericOf(t.session)).toBeNull();
  });

  it('leaving the view hides the input; the typed value stays', async () => {
    const t = await aTool();
    t.move(30, 40);
    keys(t, '10');

    t.leave();
    expect(numericOf(t.session)).toBeNull();

    t.move(30, 40);
    expect(textsOf(t.session)).toEqual(['10', '53.13']);
  });

  it('deactivate removes the input', async () => {
    const t = await aTool();
    t.move(30, 40);

    t.tool.deactivate();

    expect(numericOf(t.session)).toBeNull();
  });
});

describe('clickTool follows a step changed without an event (M32)', () => {
  it('a move that finds other fields empties the input', async () => {
    let fields: readonly InputField[] = POLAR_FIELDS;
    const t = await aTool({ fields: () => fields });
    t.move(30, 40);
    keys(t, '10');
    t.key('Tab');

    fields = XY_FIELDS;
    t.move(30, 40);

    expect(numericOf(t.session)?.fields.map((f) => [f.id, f.typed])).toEqual([
      ['x', false],
      ['y', false],
    ]);
    expect(t.calls.at(-1)?.input).toBeUndefined();
  });

  it('the same fields keep the typed values', async () => {
    const t = await aTool();
    t.move(30, 40);
    keys(t, '10');
    t.move(31, 40);
    expect(numericOf(t.session)?.fields[0]?.text).toBe('10');
  });
});

describe('withoutLocked (M32)', () => {
  const all = [
    { kind: 'horizontal' },
    { kind: 'vertical' },
    { kind: 'parallel' },
    { kind: 'perpendicular' },
    { kind: 'tangent' },
    { kind: 'equal' },
    { kind: 'pointOnCurve' },
  ] as const;

  it('a locked direction drops the axes, parallel, perpendicular and tangent', () => {
    expect(withoutLocked(all, { direction: true, size: false }).map((i) => i.kind)).toEqual([
      'equal',
      'pointOnCurve',
    ]);
  });

  it('a locked size drops equal', () => {
    expect(withoutLocked(all, { direction: false, size: true }).map((i) => i.kind)).toEqual([
      'horizontal',
      'vertical',
      'parallel',
      'perpendicular',
      'tangent',
      'pointOnCurve',
    ]);
  });

  it('nothing locked keeps all', () => {
    expect(withoutLocked(all, { direction: false, size: false })).toEqual(all);
  });
});

describe('snapAt with the point of the numeric input (M32)', () => {
  it('returns it as a free target, without the snapper and the grid', async () => {
    const { ctx, session } = await sketching();
    // The origin would snap (fix) and the grid would round 0.3.
    const target = snapAt(ctx, session, 0, 0, { grid: 1, infer: true, input: [0.3, 0.4] });
    expect(target).toEqual(freeTarget([0.3, 0.4]));
  });
});

describe('constrainPolar (spec 12, M32 "constrain")', () => {
  const from: Vec2 = [10, 10];

  it('without values the cursor', () => {
    expect(constrainPolar(from, [13, 14], new Map())).toEqual([13, 14]);
  });

  it('a length: the point in the direction of the cursor at that distance', () => {
    expectNear(constrainPolar(from, [13, 14], new Map([['length', 10]])), [16, 18]);
  });

  it('a length with the cursor on the start: the start (degenerate)', () => {
    expect(constrainPolar(from, from, new Map([['length', 10]]))).toEqual(from);
  });

  it('an angle: the projection of the cursor onto the ray', () => {
    expectNear(constrainPolar(from, [15, 30], new Map([['angle', 0]])), [15, 10]);
  });

  it('an angle with the cursor behind the start: the start (degenerate)', () => {
    expectNear(constrainPolar(from, [5, 30], new Map([['angle', 0]])), from);
  });

  it('both: the fixed point', () => {
    const values = new Map([
      ['length', 2],
      ['angle', 90 * DEG],
    ]);
    expectNear(constrainPolar(from, [100, -100], values), [10, 12]);
  });

  it('measurePolar gives the length and the angle in [0, 2π)', () => {
    const m = measurePolar(from, [10, 7]);
    expect(m.get('length')).toBeCloseTo(3, 9);
    expect(m.get('angle')).toBeCloseTo(270 * DEG, 9);
  });
});

describe('axisOfAngle (spec 12, M32 "Úhel")', () => {
  it.each([
    [0, 'horizontal'],
    [180, 'horizontal'],
    [-180, 'horizontal'],
    [360, 'horizontal'],
    [90, 'vertical'],
    [270, 'vertical'],
    [-90, 'vertical'],
    [30, null],
    [179.9, null],
  ])('%d° → %s', (deg, axis) => {
    expect(axisOfAngle(deg * DEG)).toBe(axis);
  });
});
