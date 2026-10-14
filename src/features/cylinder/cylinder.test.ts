import { describe, expect, it } from 'vitest';
import { ObservableValue, createSequentialIdGenerator } from '@/core';
import { ORIGIN_AXIS_IDS, ORIGIN_PLANE_IDS, bodyId, createFeatureSchemaRegistry } from '@/document';
import type { FeatureId, FeatureInstance } from '@/document';
import { aFeature } from '@/document/testing';
import {
  SELECT_TOOL,
  createSelectionModel,
  createToolManager,
  createToolRegistry,
} from '@/interaction';
import type { FeatureEditor, FeatureEditSession } from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import { createFakeKernel } from '@/kernel/testing';
import { anOpsSession } from '@/ops/testing';
import { registerPlugin } from '@/plugin-api';
import {
  EMPTY_NAMES,
  EMPTY_STATE,
  bodiesOf,
  createBuilderRegistry,
  createRegenerator,
} from '@/regen';
import type { Body, RegenState } from '@/regen';
import { aBuildContext, stoppedClock } from '@/regen/testing';
import { cylinderBuilder } from './builder';
import { cylinderSchema } from './schema';
import type { CylinderParams } from './schema';
import { cylinderMessages } from './messages';
import { cylinderTool } from './tool';
import * as cylinder from '.';

/** The origin planes and axes EMPTY_STATE is seeded with (spec 07); every builder keeps them in front. */
const ORIGIN_KEYS: readonly string[] = [
  ORIGIN_PLANE_IDS.xy,
  ORIGIN_PLANE_IDS.xz,
  ORIGIN_PLANE_IDS.yz,
  ORIGIN_AXIS_IDS.x,
  ORIGIN_AXIS_IDS.y,
  ORIGIN_AXIS_IDS.z,
];

function aCylinder(
  id: string,
  params: Partial<CylinderParams> = {},
): FeatureInstance<CylinderParams> {
  return aFeature({ id, type: 'cylinder', params: { ...cylinderSchema.defaults(), ...params } });
}

async function build(
  feature: FeatureInstance<CylinderParams>,
  state: RegenState = EMPTY_STATE,
  kernel = createFakeKernel(),
): Promise<RegenState> {
  const output = await cylinderBuilder.build({ feature, state }, aBuildContext(kernel, state));
  if (!output.ok) expect.fail(`Unexpected build error: ${output.error.message}`);
  return output.state;
}

describe('cylinder public API', () => {
  it('exports exactly cylinderPlugin', () => {
    expect(Object.keys(cylinder)).toEqual(['cylinderPlugin']);
  });

  it('cylinderPlugin joins the schema and the builder of type cylinder', () => {
    expect(cylinder.cylinderPlugin.schema).toBe(cylinderSchema);
    expect(cylinder.cylinderPlugin.builder).toBe(cylinderBuilder);
    expect(cylinderSchema.type).toBe('cylinder');
    expect(cylinderBuilder.type).toBe('cylinder');
  });

  it('cylinderPlugin brings the messages and the tool of the cylinder', () => {
    expect(cylinder.cylinderPlugin.messages).toBe(cylinderMessages);
    expect(cylinder.cylinderPlugin.tools).toEqual([cylinderTool]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(cylinder.cylinderPlugin)).toBe(true);
    expect(Object.isFrozen(cylinder.cylinderPlugin.tools)).toBe(true);
  });

  it('registers schema, builder and tool through registerPlugin', () => {
    const regs = {
      schemas: createFeatureSchemaRegistry(),
      builders: createBuilderRegistry(),
      tools: createToolRegistry(),
    };
    registerPlugin(cylinder.cylinderPlugin, regs);
    expect(regs.tools.get('cylinder')).toBe(cylinderTool);
  });
});

describe('cylinderSchema', () => {
  it('is version 1 of type cylinder with the Tabler icon cylinder', () => {
    expect(cylinderSchema).toMatchObject({
      type: 'cylinder',
      version: 1,
      label: 'cylinder.label',
      icon: 'cylinder',
    });
  });

  it('has the params base, axis, radius, height in this order with translation keys', () => {
    expect(
      Object.entries(cylinderSchema.params).map(([key, spec]) => [key, spec.kind, spec.label]),
    ).toEqual([
      ['base', 'point', 'cylinder.base'],
      ['axis', 'enum', 'cylinder.axis'],
      ['radius', 'length', 'cylinder.radius'],
      ['height', 'length', 'cylinder.height'],
    ]);
  });

  it('axis is an enum x, y, z with translated option labels, z by default', () => {
    const axis = cylinderSchema.params['axis'];
    if (axis?.kind !== 'enum') expect.fail('axis is not an enum param');
    expect(axis.default).toBe('z');
    expect(axis.options).toEqual([
      { value: 'x', label: 'cylinder.axis.x' },
      { value: 'y', label: 'cylinder.axis.y' },
      { value: 'z', label: 'cylinder.axis.z' },
    ]);
  });

  it('radius and height have the exclusive lower bound 0 (Q050)', () => {
    expect(cylinderSchema.params['radius']).toMatchObject({
      default: 5,
      min: 0,
      exclusiveMin: true,
    });
    expect(cylinderSchema.params['height']).toMatchObject({
      default: 10,
      min: 0,
      exclusiveMin: true,
    });
  });

  it('is frozen deeply, param specs, enum options and the base default included', () => {
    expect(Object.isFrozen(cylinderSchema)).toBe(true);
    expect(Object.isFrozen(cylinderSchema.params)).toBe(true);
    for (const [key, spec] of Object.entries(cylinderSchema.params)) {
      expect(Object.isFrozen(spec), key).toBe(true);
    }
    const base = cylinderSchema.params['base'];
    if (base?.kind !== 'point') expect.fail('base is not a point param');
    expect(Object.isFrozen(base.default)).toBe(true);
    const axis = cylinderSchema.params['axis'];
    if (axis?.kind !== 'enum') expect.fail('axis is not an enum param');
    expect(Object.isFrozen(axis.options)).toBe(true);
    for (const option of axis.options) expect(Object.isFrozen(option)).toBe(true);
  });

  it('defaults are base [0,0,0], axis z, radius 5, height 10 and pass validation', () => {
    expect(cylinderSchema.defaults()).toEqual({
      base: [0, 0, 0],
      axis: 'z',
      radius: 5,
      height: 10,
    });
    expect(cylinderSchema.validate(cylinderSchema.defaults())).toEqual([]);
  });

  it('defaults returns a new object every call', () => {
    const a = cylinderSchema.defaults();
    const b = cylinderSchema.defaults();
    expect(a).not.toBe(b);
    expect(a.base).not.toBe(b.base);
    expect(a).toEqual(b);
  });

  it.each(['radius', 'height'] as const)('rejects a zero or negative %s', (key) => {
    for (const value of [0, -0, -1]) {
      const issues = cylinderSchema.validate({ ...cylinderSchema.defaults(), [key]: value });
      expect(issues, `${key} = ${String(value)}`).toEqual([
        { param: key, code: 'param.atOrBelowMin', params: { min: 0 } },
      ]);
    }
  });

  it.each(['radius', 'height'] as const)('rejects a NaN or infinite %s', (key) => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const issues = cylinderSchema.validate({ ...cylinderSchema.defaults(), [key]: value });
      expect(issues, `${key} = ${String(value)}`).toEqual([
        { param: key, code: 'param.wrongType' },
      ]);
    }
  });

  it('rejects an unknown axis', () => {
    for (const axis of ['w', 'X', '']) {
      expect(cylinderSchema.validate({ ...cylinderSchema.defaults(), axis }), axis).toEqual([
        { param: 'axis', code: 'param.unknownOption' },
      ]);
    }
  });

  it.each([[[0, 0]], [[0, 0, Number.NaN]], ['0,0,0'], [undefined]])('rejects base %j', (base) => {
    const issues = cylinderSchema.validate({ ...cylinderSchema.defaults(), base });
    expect(issues.map((i) => i.param)).toEqual(['base']);
  });

  it('rejects params that are not an object, missing and unexpected params', () => {
    expect(cylinderSchema.validate(null)).not.toEqual([]);
    const withoutRadius = Object.fromEntries(
      Object.entries(cylinderSchema.defaults()).filter(([key]) => key !== 'radius'),
    );
    expect(cylinderSchema.validate(withoutRadius).map((i) => i.param)).toEqual(['radius']);
    expect(
      cylinderSchema.validate({ ...cylinderSchema.defaults(), size: 1 }).map((i) => i.param),
    ).toEqual(['size']);
  });
});

describe('cylinderMessages', () => {
  /** Every translation key of the schema: its label, the param labels and enum option labels. */
  function schemaKeys(): readonly string[] {
    return [
      cylinderSchema.label,
      ...Object.values(cylinderSchema.params).flatMap((spec) => [
        spec.label,
        ...(spec.kind === 'enum' ? spec.options.map((o) => o.label) : []),
      ]),
    ];
  }

  it.each(['cs', 'en'] as const)('%s has a text for every key of the schema', (lang) => {
    for (const key of schemaKeys()) {
      expect(cylinderMessages[lang][key], `${lang}: ${key}`).toEqual(expect.any(String));
      expect(cylinderMessages[lang][key], `${lang}: ${key}`).not.toBe('');
    }
  });

  it('cs and en have the same keys', () => {
    expect(Object.keys(cylinderMessages.cs).sort()).toEqual(
      Object.keys(cylinderMessages.en).sort(),
    );
  });

  it('has the texts of the plan', () => {
    expect(schemaKeys().map((key) => cylinderMessages.cs[key])).toEqual([
      'Válec',
      'Střed podstavy',
      'Osa',
      'X',
      'Y',
      'Z',
      'Poloměr',
      'Výška',
    ]);
    expect(schemaKeys().map((key) => cylinderMessages.en[key])).toEqual([
      'Cylinder',
      'Base center',
      'Axis',
      'X',
      'Y',
      'Z',
      'Radius',
      'Height',
    ]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(cylinderMessages)).toBe(true);
    expect(Object.isFrozen(cylinderMessages.cs)).toBe(true);
    expect(Object.isFrozen(cylinderMessages.en)).toBe(true);
  });
});

describe('cylinderBuilder', () => {
  it('adds one body bodyId(feature), created and last modified by the feature (ADR 0015)', async () => {
    const feature = aCylinder('c1');
    const state = await build(feature);
    const id = bodyId(feature.id);
    expect([...state.artifacts.keys()]).toEqual([...ORIGIN_KEYS, id]);
    expect(state.artifacts.get(id)).toMatchObject({
      kind: 'body',
      id: 'c1/body',
      origin: 'c1',
      lastModifiedBy: 'c1',
    });
  });

  it('names the faces top, bottom and side by their roles (spec 08, M14)', async () => {
    const feature = aCylinder('c1', { axis: 'z' });
    const state = await build(feature);
    const body = state.artifacts.get(bodyId(feature.id));
    if (body?.kind !== 'body') expect.fail('No body');
    expect(body.names).not.toBe(EMPTY_NAMES);
    // The fake models the cylinder as its AABB: along +z bottom is face 4, top face 5.
    expect([...body.names.faceEntries]).toEqual([
      ['c1/face:bottom', [4]],
      ['c1/face:side', [0, 1, 2, 3]],
      ['c1/face:top', [5]],
    ]);
  });

  // base [1, 2, 3], radius 2, height 4: along the axis base..base+4, across it base ± 2.
  it.each([
    ['x', { min: [1, 0, 1], max: [5, 4, 5] }],
    ['y', { min: [-1, 2, 1], max: [3, 6, 5] }],
    ['z', { min: [-1, 0, 3], max: [3, 4, 7] }],
  ] as const)('makes a cylinder along the axis %s', async (axis, want) => {
    const kernel = createFakeKernel();
    const feature = aCylinder('c1', { base: [1, 2, 3], axis, radius: 2, height: 4 });
    const state = await build(feature, EMPTY_STATE, kernel);
    const body = state.artifacts.get(bodyId(feature.id));
    if (body?.kind !== 'body') expect.fail('No body');
    const box = await kernel.boundingBox(body.shape);
    for (const k of [0, 1, 2] as const) {
      expect(box.min[k], `min[${String(k)}]`).toBeCloseTo(want.min[k], 9);
      expect(box.max[k], `max[${String(k)}]`).toBeCloseTo(want.max[k], 9);
    }
    expect(kernel.callCount('makeCylinder')).toBe(1);
  });

  it('keeps the artifacts of the input state and does not change it', async () => {
    const kernel = createFakeKernel();
    const c1 = aCylinder('c1');
    const first = await build(c1, EMPTY_STATE, kernel);
    const firstBody = first.artifacts.get(bodyId(c1.id));
    const second = await build(aCylinder('c2'), first, kernel);
    expect([...first.artifacts.keys()]).toEqual([...ORIGIN_KEYS, 'c1/body']);
    expect([...second.artifacts.keys()]).toEqual([...ORIGIN_KEYS, 'c1/body', 'c2/body']);
    expect(second.artifacts.get(bodyId(c1.id))).toBe(firstBody);
    expect([...EMPTY_STATE.artifacts.keys()]).toEqual(ORIGIN_KEYS);
  });

  it('freezes the output state and the new body', async () => {
    const feature = aCylinder('c1');
    const state = await build(feature);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.artifacts.get(bodyId(feature.id)))).toBe(true);
  });
});

describe('cylinder plugin in the Regenerator', () => {
  it('regenerates a studio with two cylinders into two bodies', async () => {
    const kernel = createFakeKernel();
    const schemas = createFeatureSchemaRegistry();
    const builders = createBuilderRegistry();
    registerPlugin(cylinder.cylinderPlugin, { schemas, builders, tools: createToolRegistry() });
    const regenerator = createRegenerator({ kernel, schemas, builders, now: stoppedClock });
    const features = [aCylinder('c1'), aCylinder('c2', { axis: 'x', base: [20, 0, 0] })];

    const result = await regenerator.run({ features, rollbackIndex: features.length });

    if (result === 'superseded') expect.fail('Unexpected superseded run');
    const bodies: readonly Body[] = bodiesOf(result.finalState);
    expect(bodies.map((b) => [b.id, b.origin, b.lastModifiedBy])).toEqual([
      ['c1/body', 'c1', 'c1'],
      ['c2/body', 'c2', 'c2'],
    ]);
    expect([...result.statuses]).toEqual([
      ['c1' as FeatureId, { kind: 'ok' }],
      ['c2' as FeatureId, { kind: 'ok' }],
    ]);
    expect(await kernel.liveHandleCount()).toBe(2);
  });

  it('reports an invalid radius as a param error without calling the kernel', async () => {
    const kernel = createFakeKernel();
    const schemas = createFeatureSchemaRegistry();
    const builders = createBuilderRegistry();
    registerPlugin(cylinder.cylinderPlugin, { schemas, builders, tools: createToolRegistry() });
    const regenerator = createRegenerator({ kernel, schemas, builders, now: stoppedClock });
    const features = [aCylinder('c1', { radius: 0 })];

    const result = await regenerator.run({ features, rollbackIndex: features.length });

    if (result === 'superseded') expect.fail('Unexpected superseded run');
    expect(result.statuses.get('c1' as FeatureId)?.kind).toBe('error');
    expect(kernel.callCount('makeCylinder')).toBe(0);
  });
});

/** A FeatureEditor that records create calls; `open` pretends a session is already open. */
function aRecordingEditor(open = false) {
  const created: string[] = [];
  const session: FeatureEditSession = {
    mode: 'create',
    featureId: aFeature().id,
    schema: cylinderSchema,
    state: new ObservableValue({
      params: {},
      issues: [],
      fields: [],
      activeRefParam: null,
      open: true,
      name: 'Cylinder 1',
    }),
    setParam: () => expect.fail('setParam is not expected'),
    setParams: () => expect.fail('setParams is not expected'),
    removeRef: () => expect.fail('removeRef is not expected'),
    focusRefParam: () => expect.fail('focusRefParam is not expected'),
    commit: () => expect.fail('commit is not expected'),
    cancel: () => expect.fail('cancel is not expected'),
  };
  const current = new ObservableValue<FeatureEditSession | null>(open ? session : null);
  const editor: FeatureEditor = {
    current,
    create(type) {
      created.push(type);
      current.set(session);
      return session;
    },
    edit: () => expect.fail('edit is not expected'),
  };
  return { editor, created };
}

function aToolManager(editor: FeatureEditor) {
  const registry = createToolRegistry();
  registry.register(SELECT_TOOL);
  registry.register(cylinderTool);
  const ops = anOpsSession();
  const manager = createToolManager({
    registry,
    ctx: {
      viewport: new FakeViewport(),
      selection: createSelectionModel({ regen: new FakeRegenStatus() }),
      doc: ops.doc,
      ops: ops.dispatcher,
      ids: createSequentialIdGenerator('t'),
      features: editor,
    },
    defaultToolId: SELECT_TOOL.id,
  });
  const emitted: string[] = [];
  manager.active.subscribe(() => emitted.push(manager.active.get()));
  return { manager, emitted };
}

describe('cylinderTool', () => {
  it('is the primitive tool cylinder with the shortcut C', () => {
    expect(cylinderTool).toMatchObject({
      id: 'cylinder',
      label: 'cylinder.label',
      icon: 'cylinder',
      group: 'primitive',
      shortcut: 'C',
    });
  });

  it('labels the tool with a key the cylinder messages translate (ADR 0014)', () => {
    expect(cylinderMessages.cs[cylinderTool.label]).toBe('Válec');
    expect(cylinderMessages.en[cylinderTool.label]).toBe('Cylinder');
  });

  it('opens the dialog for a new cylinder and returns to the default tool', () => {
    const { editor, created } = aRecordingEditor();
    const { manager, emitted } = aToolManager(editor);

    manager.activate('cylinder');

    expect(created).toEqual(['cylinder']);
    expect(emitted).toEqual(['cylinder', 'select']);
    expect(manager.active.get()).toBe('select');
  });

  it('only finishes while another session is open', () => {
    const { editor, created } = aRecordingEditor(true);
    const { manager, emitted } = aToolManager(editor);

    manager.activate('cylinder');

    expect(created).toEqual([]);
    expect(emitted).toEqual(['cylinder', 'select']);
  });

  it('creates a new tool on every activation', () => {
    expect(cylinderTool.create()).not.toBe(cylinderTool.create());
  });
});
