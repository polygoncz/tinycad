import { describe, expect, it } from 'vitest';
import { ObservableValue, createSequentialIdGenerator } from '@/core';
import type { Plane, Vec3 } from '@/core';
import {
  ORIGIN_AXIS_IDS,
  ORIGIN_PLANES,
  bodyId,
  createFeatureSchemaRegistry,
  isParamVisible,
} from '@/document';
import type {
  AxisRef,
  BodyRef,
  FeatureId,
  FeatureInstance,
  SketchEntityRef,
  SketchRegionRef,
} from '@/document';
import { aFeature } from '@/document/testing';
import {
  SELECT_TOOL,
  createSelectionModel,
  createToolManager,
  createToolRegistry,
} from '@/interaction';
import type { FeatureEditor, FeatureEditSession } from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import type { BooleanOp, ShapeHandle } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import type { FakeKernel } from '@/kernel/testing';
import { anOpsSession } from '@/ops/testing';
import { registerPlugin } from '@/plugin-api';
import { EMPTY_NAMES, EMPTY_STATE, createBuilderRegistry } from '@/regen';
import type { Artifact, ArtifactId, Body, BuildOutput, ModelingKernel, RegenState } from '@/regen';
import { aBuildContext, aSketchArtifact } from '@/regen/testing';
import { parseSketchData } from '@/sketch';
import type { SketchEntity } from '@/sketch';
import { revolveBuilder } from './builder';
import { revolveMessages } from './messages';
import { revolveSchema } from './schema';
import type { RevolveParams } from './schema';
import { revolveTool } from './tool';
import * as revolve from '.';

// ---------------------------------------------------------------------------------------------
// Helpers

const FULL_TURN = 2 * Math.PI;

function bodyRef(id: string): BodyRef {
  return { kind: 'body', body: bodyId(id as FeatureId) };
}

function regionRef(sketch: string, region = 'r1'): SketchRegionRef {
  return { kind: 'region', sketch: sketch as FeatureId, region };
}

function entityRef(sketch: string, entity: string): SketchEntityRef {
  return { kind: 'sketchEntity', sketch: sketch as FeatureId, entity };
}

const Z_AXIS: AxisRef = { kind: 'axis', axis: ORIGIN_AXIS_IDS.z };

function aRevolve(id: string, params: Partial<RevolveParams> = {}): FeatureInstance<RevolveParams> {
  return aFeature({
    id,
    type: 'revolve',
    params: { ...revolveSchema.defaults(), regions: [regionRef('s1')], axis: Z_AXIS, ...params },
  });
}

function xzPlane(): Plane {
  const xz = ORIGIN_PLANES[1];
  if (xz === undefined) throw new Error('ORIGIN_PLANES has no XZ plane');
  return xz.plane;
}

/**
 * Validated sketch entities on XZ: construction line 'c' from (0, 0) to (0, 10) – the world axis
 * Z – and the circle 'k' around it.
 */
function axisEntities(): readonly SketchEntity[] {
  const r = parseSketchData(
    [
      { kind: 'point', id: 'o', x: 0, y: 0 },
      { kind: 'point', id: 'e', x: 0, y: 10 },
      { kind: 'line', id: 'c', p1: 'o', p2: 'e', construction: true },
      { kind: 'circle', id: 'k', center: 'o', radius: 2 },
    ],
    [],
  );
  if (!r.ok) throw new Error(`invalid test sketch: ${JSON.stringify(r.error)}`);
  return r.value.entities;
}

/** A kernel call of boolean, as applyBodyOperation made it. */
interface BooleanCall {
  readonly op: BooleanOp;
  readonly targets: readonly ShapeHandle[];
  readonly tools: readonly ShapeHandle[];
}

/** The FakeKernel with every boolean call recorded (copies of the handle lists). */
function aRecordingKernel(): {
  readonly fake: FakeKernel;
  readonly kernel: ModelingKernel;
  readonly calls: readonly BooleanCall[];
} {
  const fake = createFakeKernel();
  const calls: BooleanCall[] = [];
  const kernel: ModelingKernel = {
    makeBox: (p) => fake.makeBox(p),
    makeCylinder: (p) => fake.makeCylinder(p),
    transform: (shape, m) => fake.transform(shape, m),
    boolean(op, targets, tools) {
      calls.push({ op, targets: [...targets], tools: [...tools] });
      return fake.boolean(op, targets, tools);
    },
    makeFace: (p) => fake.makeFace(p),
    extrude: (profile, direction, distance) => fake.extrude(profile, direction, distance),
    revolve: (profile, axis, angle) => fake.revolve(profile, axis, angle),
    fillet: (shape, edges, radius) => fake.fillet(shape, edges, radius),
    chamfer: (shape, edges, distance) => fake.chamfer(shape, edges, distance),
    boundingBox: (shape) => fake.boundingBox(shape),
    topology: (shape) => fake.topology(shape),
  };
  return { fake, kernel, calls };
}

/**
 * The origin geometry and the sketch 's1' on XZ with the rectangle x ∈ [5, 10], z ∈ [0, 10] as
 * region 'r1' and the entities of axisEntities(); with `box`, a box body of the feature 'b'
 * [0, 20]³ after it.
 */
async function sketchState(kernel: ModelingKernel, box = false): Promise<RegenState> {
  const plane = xzPlane();
  const { shape: face } = await kernel.makeFace({
    plane,
    outer: [
      { kind: 'line', from: [5, 0], to: [10, 0] },
      { kind: 'line', from: [10, 0], to: [10, 10] },
      { kind: 'line', from: [10, 10], to: [5, 10] },
      { kind: 'line', from: [5, 10], to: [5, 0] },
    ],
    holes: [],
  });
  const sketch = aSketchArtifact('s1', [face], { plane, entities: axisEntities() });
  const artifacts = new Map<ArtifactId, Artifact>(EMPTY_STATE.artifacts).set(sketch.id, sketch);
  if (box) {
    const { shape } = await kernel.makeBox({ origin: [0, 0, 0], size: [20, 20, 20] });
    const id = bodyId('b' as FeatureId);
    artifacts.set(
      id,
      Object.freeze({
        kind: 'body',
        id,
        origin: 'b' as FeatureId,
        lastModifiedBy: 'b' as FeatureId,
        shape,
        names: EMPTY_NAMES,
      }),
    );
  }
  return Object.freeze({ artifacts });
}

async function run(
  feature: FeatureInstance<RevolveParams>,
  state: RegenState,
  kernel: ModelingKernel,
): Promise<BuildOutput> {
  return revolveBuilder.build({ feature, state }, aBuildContext(kernel, state));
}

async function build(
  feature: FeatureInstance<RevolveParams>,
  state: RegenState,
  kernel: ModelingKernel,
): Promise<RegenState> {
  const output = await run(feature, state, kernel);
  if (!output.ok) expect.fail(`Unexpected build error: ${output.error.message}`);
  return output.state;
}

function bodyOf(state: RegenState, feature: string): Body {
  const body = state.artifacts.get(bodyId(feature as FeatureId));
  if (body?.kind !== 'body') expect.fail(`No body of ${feature}`);
  return body;
}

/** The bounding box of the body of `feature`, rounded to 1e-9 against the noise of rotations. */
async function bboxOf(
  kernel: ModelingKernel,
  state: RegenState,
  feature: string,
): Promise<{ min: Vec3; max: Vec3 }> {
  const { min, max } = await kernel.boundingBox(bodyOf(state, feature).shape);
  const round = (v: Vec3): Vec3 => [round9(v[0]), round9(v[1]), round9(v[2])];
  return { min: round(min), max: round(max) };
}

function round9(x: number): number {
  const r = Math.round(x * 1e9) / 1e9;
  // -0 and 0 are the same coordinate; toEqual tells them apart.
  return r === 0 ? 0 : r;
}

// ---------------------------------------------------------------------------------------------

describe('revolve public API', () => {
  it('exports exactly revolvePlugin', () => {
    expect(Object.keys(revolve)).toEqual(['revolvePlugin']);
  });

  it('revolvePlugin joins the schema, the builder, the tool and the messages', () => {
    expect(revolve.revolvePlugin.schema).toBe(revolveSchema);
    expect(revolve.revolvePlugin.builder).toBe(revolveBuilder);
    expect(revolve.revolvePlugin.tools).toEqual([revolveTool]);
    expect(revolve.revolvePlugin.messages).toBe(revolveMessages);
    expect(revolveSchema.type).toBe('revolve');
    expect(revolveBuilder.type).toBe('revolve');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(revolve.revolvePlugin)).toBe(true);
    expect(Object.isFrozen(revolve.revolvePlugin.tools)).toBe(true);
  });

  it('registers schema, builder and tool through registerPlugin', () => {
    const regs = {
      schemas: createFeatureSchemaRegistry(),
      builders: createBuilderRegistry(),
      tools: createToolRegistry(),
    };
    registerPlugin(revolve.revolvePlugin, regs);
    expect(regs.schemas.get('revolve')).toBe(revolveSchema);
    expect(regs.builders.get('revolve')).toBe(revolveBuilder);
    expect(regs.tools.get('revolve')).toBe(revolveTool);
  });
});

describe('revolveSchema', () => {
  it('is version 1 of type revolve with the Tabler icon rotate-360', () => {
    expect(revolveSchema).toMatchObject({
      type: 'revolve',
      version: 1,
      label: 'revolve.label',
      icon: 'rotate-360',
    });
  });

  it('has the params in the order of the plan with key labels (ADR 0014)', () => {
    expect(Object.entries(revolveSchema.params).map(([key, spec]) => [key, spec.label])).toEqual([
      ['regions', 'revolve.regions'],
      ['axis', 'revolve.axis'],
      ['operation', 'revolve.operation'],
      ['targets', 'revolve.targets'],
      ['angle', 'revolve.angle'],
      ['flip', 'revolve.flip'],
    ]);
  });

  it('has the kinds, bounds and groups of the plan', () => {
    const p = revolveSchema.params;
    expect(p['regions']).toMatchObject({ kind: 'region', min: 1 });
    expect(p['axis']).toMatchObject({ kind: 'axis' });
    expect(p['targets']).toMatchObject({ kind: 'bodies', min: 1, group: 'revolve.group.merge' });
    expect(p['angle']).toMatchObject({
      kind: 'angle',
      default: FULL_TURN,
      min: 0,
      exclusiveMin: true,
      max: FULL_TURN,
    });
    expect(p['angle']).not.toHaveProperty('exclusiveMax');
    expect(p['flip']).toMatchObject({ kind: 'boolean', default: false });
  });

  it('has the operation enum new, add, remove, intersect with new by default', () => {
    expect(revolveSchema.params['operation']).toEqual({
      kind: 'enum',
      label: 'revolve.operation',
      default: 'new',
      options: [
        { value: 'new', label: 'revolve.operation.new' },
        { value: 'add', label: 'revolve.operation.add' },
        { value: 'remove', label: 'revolve.operation.remove' },
        { value: 'intersect', label: 'revolve.operation.intersect' },
      ],
    });
  });

  it('is frozen deeply, param specs and enum options included', () => {
    expect(Object.isFrozen(revolveSchema)).toBe(true);
    expect(Object.isFrozen(revolveSchema.params)).toBe(true);
    for (const [key, spec] of Object.entries(revolveSchema.params)) {
      expect(Object.isFrozen(spec), key).toBe(true);
    }
    const op = revolveSchema.params['operation'];
    if (op?.kind !== 'enum') expect.fail('operation is not an enum param');
    expect(Object.isFrozen(op.options)).toBe(true);
    for (const option of op.options) expect(Object.isFrozen(option)).toBe(true);
  });

  it('defaults are a new full revolve without regions and axis', () => {
    expect(revolveSchema.defaults()).toEqual({
      regions: [],
      axis: null,
      operation: 'new',
      targets: [],
      angle: FULL_TURN,
      flip: false,
    });
  });

  it('defaults returns a new object every call', () => {
    const a = revolveSchema.defaults();
    const b = revolveSchema.defaults();
    expect(a).not.toBe(b);
    expect(a.regions).not.toBe(b.regions);
    expect(a.targets).not.toBe(b.targets);
    expect(a).toEqual(b);
  });

  it('defaults alone ask for a region and an axis (R24)', () => {
    expect(revolveSchema.validate(revolveSchema.defaults())).toEqual([
      { param: 'regions', code: 'param.tooFewRefs', params: { min: 1 } },
      { param: 'axis', code: 'param.tooFewRefs', params: { min: 1 } },
    ]);
  });

  it('defaults with a region and an axis pass validation', () => {
    const params = { ...revolveSchema.defaults(), regions: [regionRef('s1')] };
    expect(revolveSchema.validate({ ...params, axis: Z_AXIS })).toEqual([]);
    expect(revolveSchema.validate({ ...params, axis: entityRef('s1', 'c') })).toEqual([]);
  });

  it('asks for a target only for an operation other than new', () => {
    const valid = aRevolve('x').params;
    expect(revolveSchema.validate({ ...valid, operation: 'new', targets: 'nonsense' })).toEqual([]);
    expect(revolveSchema.validate({ ...valid, operation: 'add' })).toEqual([
      { param: 'targets', code: 'param.tooFewRefs', params: { min: 1 } },
    ]);
    expect(
      revolveSchema.validate({ ...valid, operation: 'remove', targets: [bodyRef('b')] }),
    ).toEqual([]);
  });

  it('accepts a full turn and rejects 0 and more than a full turn', () => {
    const valid = aRevolve('x').params;
    expect(revolveSchema.validate({ ...valid, angle: FULL_TURN })).toEqual([]);
    expect(revolveSchema.validate({ ...valid, angle: Math.PI / 2 })).toEqual([]);
    expect(revolveSchema.validate({ ...valid, angle: 0 })).toEqual([
      expect.objectContaining({ param: 'angle' }),
    ]);
    expect(revolveSchema.validate({ ...valid, angle: FULL_TURN + 0.1 })).toEqual([
      expect.objectContaining({ param: 'angle' }),
    ]);
  });
});

describe('revolve param visibility', () => {
  const spec = (key: string) => {
    const s = revolveSchema.params[key];
    if (s === undefined) expect.fail(`no param ${key}`);
    return s;
  };

  it('shows targets only for add, remove and intersect', () => {
    expect(isParamVisible(spec('targets'), { operation: 'new' })).toBe(false);
    expect(isParamVisible(spec('targets'), { operation: 'add' })).toBe(true);
    expect(isParamVisible(spec('targets'), { operation: 'remove' })).toBe(true);
    expect(isParamVisible(spec('targets'), { operation: 'intersect' })).toBe(true);
  });

  it('shows flip only for an angle below a full turn', () => {
    expect(isParamVisible(spec('flip'), { angle: FULL_TURN })).toBe(false);
    expect(isParamVisible(spec('flip'), { angle: FULL_TURN - 1e-10 })).toBe(false);
    expect(isParamVisible(spec('flip'), { angle: FULL_TURN - 1e-6 })).toBe(true);
    expect(isParamVisible(spec('flip'), { angle: Math.PI / 2 })).toBe(true);
  });

  it('hides flip for an angle that is not a number, without throwing', () => {
    expect(isParamVisible(spec('flip'), { angle: 'x' })).toBe(false);
    expect(isParamVisible(spec('flip'), {})).toBe(false);
  });

  it('shows the other params always', () => {
    for (const key of ['regions', 'axis', 'operation', 'angle']) {
      expect(isParamVisible(spec(key), {}), key).toBe(true);
    }
  });

  it('a hidden flip of any value passes validation', () => {
    expect(revolveSchema.validate({ ...aRevolve('x').params, flip: 'yes' })).toEqual([]);
  });
});

describe('revolveMessages', () => {
  /** Every translation key of the schema, groups included. */
  function keys(): readonly string[] {
    return [
      revolveSchema.label,
      ...Object.values(revolveSchema.params).flatMap((spec) => [
        spec.label,
        ...(spec.group === undefined ? [] : [spec.group]),
        ...(spec.kind === 'enum' ? spec.options.map((o) => o.label) : []),
      ]),
    ];
  }

  it.each(['cs', 'en'] as const)('%s has a text for every key', (lang) => {
    for (const key of keys()) {
      expect(revolveMessages[lang][key], `${lang}: ${key}`).toEqual(expect.any(String));
      expect(revolveMessages[lang][key], `${lang}: ${key}`).not.toBe('');
    }
  });

  it('cs and en have the same keys, no more than the schema needs', () => {
    expect(Object.keys(revolveMessages.cs).sort()).toEqual(Object.keys(revolveMessages.en).sort());
    expect(Object.keys(revolveMessages.cs).sort()).toEqual([...keys()].sort());
  });

  it('has the texts of the plan', () => {
    expect(revolveMessages.cs).toEqual({
      'revolve.label': 'Rotace',
      'revolve.regions': 'Oblasti',
      'revolve.axis': 'Osa',
      'revolve.operation': 'Operace',
      'revolve.operation.new': 'Nové těleso',
      'revolve.operation.add': 'Přidat',
      'revolve.operation.remove': 'Odebrat',
      'revolve.operation.intersect': 'Průnik',
      'revolve.targets': 'Sloučit s',
      'revolve.group.merge': 'Cílová tělesa',
      'revolve.angle': 'Úhel',
      'revolve.flip': 'Opačný směr',
    });
    expect(revolveMessages.en).toEqual({
      'revolve.label': 'Revolve',
      'revolve.regions': 'Regions',
      'revolve.axis': 'Axis',
      'revolve.operation': 'Operation',
      'revolve.operation.new': 'New body',
      'revolve.operation.add': 'Add',
      'revolve.operation.remove': 'Remove',
      'revolve.operation.intersect': 'Intersect',
      'revolve.targets': 'Merge with',
      'revolve.group.merge': 'Target bodies',
      'revolve.angle': 'Angle',
      'revolve.flip': 'Opposite direction',
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(revolveMessages)).toBe(true);
    expect(Object.isFrozen(revolveMessages.cs)).toBe(true);
    expect(Object.isFrozen(revolveMessages.en)).toBe(true);
  });
});

describe('revolveBuilder', () => {
  it('turns the rectangle on XZ about the axis Z by a full turn into a new body', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await sketchState(kernel);

    const out = await build(aRevolve('rv'), state, kernel);

    expect(await bboxOf(kernel, out, 'rv')).toEqual({ min: [-10, -10, 0], max: [10, 10, 10] });
    const body = bodyOf(out, 'rv');
    expect(body).toMatchObject({ id: 'rv/body', origin: 'rv', lastModifiedBy: 'rv' });
    expect(Object.isFrozen(body)).toBe(true);
    expect(fake.callCount('revolve')).toBe(1);
  });

  it('by a quarter turn sweeps the first quadrant', async () => {
    const { kernel } = aRecordingKernel();
    const state = await sketchState(kernel);

    const out = await build(aRevolve('rv', { angle: Math.PI / 2 }), state, kernel);

    expect(await bboxOf(kernel, out, 'rv')).toEqual({ min: [0, 0, 0], max: [10, 10, 10] });
  });

  it('with flip turns the other way about the reversed axis', async () => {
    const { kernel } = aRecordingKernel();
    const state = await sketchState(kernel);

    const out = await build(aRevolve('rv', { angle: Math.PI / 2, flip: true }), state, kernel);

    expect(await bboxOf(kernel, out, 'rv')).toEqual({ min: [0, -10, 0], max: [10, 0, 10] });
  });

  it('ignores a hidden flip at a full turn', async () => {
    const { kernel } = aRecordingKernel();
    const state = await sketchState(kernel);
    const revolveCalls: Vec3[] = [];
    const spying: ModelingKernel = {
      ...kernel,
      revolve(profile, axis, angle) {
        revolveCalls.push(axis.direction);
        return kernel.revolve(profile, axis, angle);
      },
    };

    await build(aRevolve('rv', { flip: true }), state, spying);

    expect(revolveCalls).toEqual([[0, 0, 1]]);
  });

  it('takes the axis from a construction line of a sketch', async () => {
    const { kernel } = aRecordingKernel();
    const state = await sketchState(kernel);

    const out = await build(aRevolve('rv', { axis: entityRef('s1', 'c') }), state, kernel);

    expect(await bboxOf(kernel, out, 'rv')).toEqual({ min: [-10, -10, 0], max: [10, 10, 10] });
  });

  it('a circle as the axis gives UNRESOLVED_REFERENCE at axis without revolving', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await sketchState(kernel);

    const output = await run(aRevolve('rv', { axis: entityRef('s1', 'k') }), state, kernel);

    if (output.ok) expect.fail('Expected an error');
    expect(output.error).toMatchObject({
      code: 'UNRESOLVED_REFERENCE',
      issues: [{ param: 'axis', code: 'param.unresolvedRef' }],
    });
    expect(fake.callCount('revolve')).toBe(0);
  });

  it('a missing sketch of the axis gives UNRESOLVED_REFERENCE at axis', async () => {
    const { kernel } = aRecordingKernel();
    const state = await sketchState(kernel);

    const output = await run(aRevolve('rv', { axis: entityRef('s9', 'c') }), state, kernel);

    if (output.ok) expect.fail('Expected an error');
    expect(output.error).toMatchObject({
      code: 'UNRESOLVED_REFERENCE',
      message: "Sketch 's9' not found",
      issues: [{ param: 'axis', code: 'param.unresolvedRef' }],
    });
  });

  it('a missing region gives UNRESOLVED_REFERENCE at regions', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await sketchState(kernel);

    const output = await run(aRevolve('rv', { regions: [regionRef('s1', 'r9')] }), state, kernel);

    if (output.ok) expect.fail('Expected an error');
    expect(output.error).toMatchObject({
      code: 'UNRESOLVED_REFERENCE',
      issues: [{ param: 'regions', code: 'param.unresolvedRef' }],
    });
    expect(fake.callCount('revolve')).toBe(0);
  });

  it('a missing target gives UNRESOLVED_REFERENCE at targets', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await sketchState(kernel);

    const output = await run(
      aRevolve('rv', { operation: 'remove', targets: [bodyRef('x')] }),
      state,
      kernel,
    );

    if (output.ok) expect.fail('Expected an error');
    expect(output.error).toMatchObject({
      code: 'UNRESOLVED_REFERENCE',
      issues: [{ param: 'targets', code: 'param.unresolvedRef' }],
    });
    expect(fake.callCount('revolve')).toBe(0);
  });

  it('remove subtracts the solid of revolution from the target, which keeps its identity', async () => {
    const { fake, kernel, calls } = aRecordingKernel();
    const state = await sketchState(kernel, true);
    const target = bodyOf(state, 'b');

    const out = await build(
      aRevolve('rv', { operation: 'remove', targets: [bodyRef('b')] }),
      state,
      kernel,
    );

    const body = bodyOf(out, 'b');
    // The names are recomputed from the kernel history (M14), the identity stays.
    expect(body).toEqual({ ...target, shape: body.shape, names: body.names, lastModifiedBy: 'rv' });
    expect([...body.names.faceEntries]).toEqual([...target.names.faceEntries]);
    expect(out.artifacts.has(bodyId('rv' as FeatureId))).toBe(false);
    expect(calls).toEqual([
      { op: 'subtract', targets: [target.shape], tools: [expect.anything()] },
    ]);
    expect(fake.callCount('revolve')).toBe(1);
  });

  it('a new revolve does not read a hidden, invalid targets', async () => {
    const { kernel } = aRecordingKernel();
    const state = await sketchState(kernel);

    const out = await build(
      aRevolve('rv', { operation: 'new', targets: [bodyRef('x')] }),
      state,
      kernel,
    );

    expect(bodyOf(out, 'rv').origin).toBe('rv');
  });

  it('lets an error of the kernel through', async () => {
    const fake = createFakeKernel();
    const state = await sketchState(fake);
    fake.failNext('revolve', 'operation-failed');

    await expect(run(aRevolve('rv'), state, fake)).rejects.toMatchObject({
      code: 'operation-failed',
    });
  });

  it('does not change the input state', async () => {
    const { kernel } = aRecordingKernel();
    const state = await sketchState(kernel, true);
    const before = [...state.artifacts.entries()];

    const out = await build(aRevolve('rv'), state, kernel);

    expect([...state.artifacts.entries()]).toEqual(before);
    expect(out.artifacts.get(bodyId('b' as FeatureId))).toBe(bodyOf(state, 'b'));
    expect(Object.isFrozen(out)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------

/** A FeatureEditor that records create calls; `open` pretends a session is already open. */
function aRecordingEditor(open = false) {
  const created: string[] = [];
  const session: FeatureEditSession = {
    mode: 'create',
    featureId: aFeature().id,
    schema: revolveSchema,
    state: new ObservableValue({
      params: {},
      issues: [],
      fields: [],
      activeRefParam: null,
      open: true,
      name: 'Revolve 1',
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
  registry.register(revolveTool);
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

describe('revolveTool', () => {
  it('is the feature tool revolve with the shortcut Shift+W', () => {
    expect(revolveTool).toMatchObject({
      id: 'revolve',
      label: 'revolve.label',
      icon: 'rotate-360',
      group: 'feature',
      shortcut: 'Shift+W',
    });
  });

  it('labels the tool with a key the revolve messages translate (ADR 0014)', () => {
    expect(revolveMessages.cs[revolveTool.label]).toBe('Rotace');
    expect(revolveMessages.en[revolveTool.label]).toBe('Revolve');
  });

  it('opens the dialog for a new revolve and returns to the default tool', () => {
    const { editor, created } = aRecordingEditor();
    const { manager, emitted } = aToolManager(editor);

    manager.activate('revolve');

    expect(created).toEqual(['revolve']);
    expect(emitted).toEqual(['revolve', 'select']);
    expect(manager.active.get()).toBe('select');
  });

  it('only finishes while another session is open', () => {
    const { editor, created } = aRecordingEditor(true);
    const { manager, emitted } = aToolManager(editor);

    manager.activate('revolve');

    expect(created).toEqual([]);
    expect(emitted).toEqual(['revolve', 'select']);
  });

  it('creates a new tool on every activation', () => {
    expect(revolveTool.create()).not.toBe(revolveTool.create());
  });
});
