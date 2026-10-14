import { describe, expect, it } from 'vitest';
import { ObservableValue, createSequentialIdGenerator } from '@/core';
import type { Vec3 } from '@/core';
import { bodyId, createFeatureSchemaRegistry } from '@/document';
import type { BodyRef, FeatureId, FeatureInstance, FeatureSchema } from '@/document';
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
import { anOpsSession } from '@/ops/testing';
import { registerPlugin } from '@/plugin-api';
import {
  EMPTY_NAMES,
  EMPTY_STATE,
  bodiesOf,
  createBuilderRegistry,
  createRegenerator,
} from '@/regen';
import type {
  ArtifactId,
  Body,
  BuildOutput,
  FeatureBuilder,
  ModelingKernel,
  RegenState,
} from '@/regen';
import { aBuildContext, aSpyBuilder, result, stoppedClock } from '@/regen/testing';
import { booleanBuilder } from './builder';
import { booleanSchema } from './schema';
import type { BooleanParams } from './schema';
import { booleanMessages } from './messages';
import { booleanTool } from './tool';
import * as boolean from '.';

// ---------------------------------------------------------------------------------------------
// Helpers

function ref(id: string): BodyRef {
  return { kind: 'body', body: bodyId(id as FeatureId) };
}

function aBoolean(id: string, params: Partial<BooleanParams> = {}): FeatureInstance<BooleanParams> {
  return aFeature({
    id,
    type: 'boolean',
    params: { ...booleanSchema.defaults(), targets: [ref('a')], tools: [ref('b')], ...params },
  });
}

/** A kernel call of boolean, as the builder made it. */
interface BooleanCall {
  readonly op: BooleanOp;
  readonly targets: readonly ShapeHandle[];
  readonly tools: readonly ShapeHandle[];
}

/** The FakeKernel with every boolean call recorded (copies of the handle lists). */
function aRecordingKernel() {
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
    boundingBox: (shape) => fake.boundingBox(shape),
  };
  return { fake, kernel, calls };
}

/** A state with one box body per entry, created by the feature named by the key. */
async function boxesState(
  kernel: ModelingKernel,
  boxes: Readonly<Record<string, { readonly origin: Vec3; readonly size: Vec3 }>>,
): Promise<RegenState> {
  const artifacts = new Map<ArtifactId, Body>();
  for (const [feature, box] of Object.entries(boxes)) {
    const { shape } = await kernel.makeBox(box);
    const id = bodyId(feature as FeatureId);
    artifacts.set(
      id,
      Object.freeze({
        kind: 'body',
        id,
        origin: feature as FeatureId,
        lastModifiedBy: feature as FeatureId,
        shape,
        names: EMPTY_NAMES,
      }),
    );
  }
  return Object.freeze({ artifacts });
}

const UNIT: Vec3 = [10, 10, 10];

/** a [0,10]³, b [5,15]³ overlapping a, c [20,30]×[0,10]² apart from both. */
function threeBoxes(kernel: ModelingKernel): Promise<RegenState> {
  return boxesState(kernel, {
    a: { origin: [0, 0, 0], size: UNIT },
    b: { origin: [5, 5, 5], size: UNIT },
    c: { origin: [20, 0, 0], size: UNIT },
  });
}

async function run(
  feature: FeatureInstance<BooleanParams>,
  state: RegenState,
  kernel: ModelingKernel,
): Promise<BuildOutput> {
  return booleanBuilder.build({ feature, state }, aBuildContext(kernel, state));
}

async function build(
  feature: FeatureInstance<BooleanParams>,
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

// ---------------------------------------------------------------------------------------------

describe('boolean public API', () => {
  it('exports exactly booleanPlugin', () => {
    expect(Object.keys(boolean)).toEqual(['booleanPlugin']);
  });

  it('booleanPlugin joins the schema, the builder, the tool and the messages', () => {
    expect(boolean.booleanPlugin.schema).toBe(booleanSchema);
    expect(boolean.booleanPlugin.builder).toBe(booleanBuilder);
    expect(boolean.booleanPlugin.tools).toEqual([booleanTool]);
    expect(boolean.booleanPlugin.messages).toBe(booleanMessages);
    expect(booleanSchema.type).toBe('boolean');
    expect(booleanBuilder.type).toBe('boolean');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(boolean.booleanPlugin)).toBe(true);
    expect(Object.isFrozen(boolean.booleanPlugin.tools)).toBe(true);
  });

  it('registers schema, builder and tool through registerPlugin', () => {
    const regs = {
      schemas: createFeatureSchemaRegistry(),
      builders: createBuilderRegistry(),
      tools: createToolRegistry(),
    };
    registerPlugin(boolean.booleanPlugin, regs);
    expect(regs.schemas.get('boolean')).toBe(booleanSchema);
    expect(regs.builders.get('boolean')).toBe(booleanBuilder);
    expect(regs.tools.get('boolean')).toBe(booleanTool);
  });
});

describe('booleanSchema', () => {
  it('is version 1 of type boolean with the Tabler icon layers-union', () => {
    expect(booleanSchema).toMatchObject({
      type: 'boolean',
      version: 1,
      label: 'boolean.label',
      icon: 'layers-union',
    });
  });

  it('has the params op, targets, tools, keepTools in this order with key labels (ADR 0014)', () => {
    expect(Object.entries(booleanSchema.params).map(([key, spec]) => [key, spec.label])).toEqual([
      ['op', 'boolean.op'],
      ['targets', 'boolean.targets'],
      ['tools', 'boolean.tools'],
      ['keepTools', 'boolean.keepTools'],
    ]);
  });

  it('has the op enum union, subtract, intersect with union by default', () => {
    expect(booleanSchema.params['op']).toEqual({
      kind: 'enum',
      label: 'boolean.op',
      default: 'union',
      options: [
        { value: 'union', label: 'boolean.op.union' },
        { value: 'subtract', label: 'boolean.op.subtract' },
        { value: 'intersect', label: 'boolean.op.intersect' },
      ],
    });
  });

  it('needs at least one target and one tool, keepTools is false by default', () => {
    expect(booleanSchema.params['targets']).toMatchObject({ kind: 'bodies', min: 1 });
    expect(booleanSchema.params['tools']).toMatchObject({ kind: 'bodies', min: 1 });
    expect(booleanSchema.params['keepTools']).toMatchObject({ kind: 'boolean', default: false });
  });

  it('is frozen deeply, param specs and enum options included', () => {
    expect(Object.isFrozen(booleanSchema)).toBe(true);
    expect(Object.isFrozen(booleanSchema.params)).toBe(true);
    for (const [key, spec] of Object.entries(booleanSchema.params)) {
      expect(Object.isFrozen(spec), key).toBe(true);
    }
    const op = booleanSchema.params['op'];
    if (op?.kind !== 'enum') expect.fail('op is not an enum param');
    expect(Object.isFrozen(op.options)).toBe(true);
    for (const option of op.options) expect(Object.isFrozen(option)).toBe(true);
  });

  it('defaults are union of empty lists without keeping tools', () => {
    expect(booleanSchema.defaults()).toEqual({
      op: 'union',
      targets: [],
      tools: [],
      keepTools: false,
    });
  });

  it('defaults with one target and one tool pass validation', () => {
    expect(
      booleanSchema.validate({
        ...booleanSchema.defaults(),
        targets: [ref('a')],
        tools: [ref('b')],
      }),
    ).toEqual([]);
  });

  it('defaults alone ask for a target and a tool', () => {
    expect(booleanSchema.validate(booleanSchema.defaults())).toEqual([
      { param: 'targets', code: 'param.tooFewRefs', params: { min: 1 } },
      { param: 'tools', code: 'param.tooFewRefs', params: { min: 1 } },
    ]);
  });

  it('defaults returns a new object every call', () => {
    const a = booleanSchema.defaults();
    const b = booleanSchema.defaults();
    expect(a).not.toBe(b);
    expect(a.targets).not.toBe(b.targets);
    expect(a.tools).not.toBe(b.tools);
    expect(a).toEqual(b);
  });

  it('rejects an unknown op and a keepTools that is not a boolean', () => {
    const valid = aBoolean('x').params;
    expect(booleanSchema.validate({ ...valid, op: 'xor' })).toEqual([
      { param: 'op', code: 'param.unknownOption' },
    ]);
    expect(booleanSchema.validate({ ...valid, keepTools: 'yes' })).toEqual([
      { param: 'keepTools', code: 'param.wrongType' },
    ]);
  });

  it('rejects a body that is a target and a tool, at its index in tools', () => {
    const issues = booleanSchema.validate({
      ...aBoolean('x').params,
      targets: [ref('a'), ref('b')],
      tools: [ref('c'), ref('b')],
    });
    expect(issues).toEqual([{ param: 'tools', code: 'boolean.sameBody', params: { index: 1 } }]);
  });

  it('reports only the first tool that is also a target', () => {
    const issues = booleanSchema.validate({
      ...aBoolean('x').params,
      targets: [ref('a'), ref('b')],
      tools: [ref('a'), ref('b')],
    });
    expect(issues).toEqual([{ param: 'tools', code: 'boolean.sameBody', params: { index: 0 } }]);
  });

  it('checks the same body only when both lists passed the shape checks', () => {
    const valid = aBoolean('x').params;
    expect(
      booleanSchema.validate({
        ...valid,
        targets: [ref('a'), { kind: 'body' }],
        tools: [ref('a')],
      }),
    ).toEqual([{ param: 'targets', code: 'param.invalidRef', params: { index: 1 } }]);
    expect(booleanSchema.validate({ ...valid, targets: [ref('a')], tools: 'a' })).toEqual([
      { param: 'tools', code: 'param.wrongType' },
    ]);
    expect(booleanSchema.validate(null)).toEqual([{ param: '', code: 'param.wrongType' }]);
  });

  it('rejects the same body twice in one list with param.duplicateRef', () => {
    const issues = booleanSchema.validate({
      ...aBoolean('x').params,
      targets: [ref('a'), ref('a')],
      tools: [ref('b')],
    });
    expect(issues).toEqual([
      { param: 'targets', code: 'param.duplicateRef', params: { index: 1 } },
    ]);
  });

  it('rejects missing and unexpected params', () => {
    const withoutKeep = Object.fromEntries(
      Object.entries(aBoolean('x').params).filter(([key]) => key !== 'keepTools'),
    );
    expect(booleanSchema.validate(withoutKeep)).toEqual([
      { param: 'keepTools', code: 'param.missing' },
    ]);
    expect(booleanSchema.validate({ ...aBoolean('x').params, mode: 1 })).toEqual([
      { param: 'mode', code: 'param.unexpected' },
    ]);
  });
});

describe('booleanMessages', () => {
  /** Every translation key of the schema and the code of its own rule. */
  function keys(): readonly string[] {
    return [
      booleanSchema.label,
      ...Object.values(booleanSchema.params).flatMap((spec) => [
        spec.label,
        ...(spec.kind === 'enum' ? spec.options.map((o) => o.label) : []),
      ]),
      'boolean.sameBody',
    ];
  }

  it.each(['cs', 'en'] as const)('%s has a text for every key', (lang) => {
    for (const key of keys()) {
      expect(booleanMessages[lang][key], `${lang}: ${key}`).toEqual(expect.any(String));
      expect(booleanMessages[lang][key], `${lang}: ${key}`).not.toBe('');
    }
  });

  it('cs and en have the same keys', () => {
    expect(Object.keys(booleanMessages.cs).sort()).toEqual(Object.keys(booleanMessages.en).sort());
  });

  it('has the texts of the plan', () => {
    expect(booleanMessages.cs).toEqual({
      'boolean.label': 'Boolean',
      'boolean.op': 'Operace',
      'boolean.op.union': 'Sjednocení',
      'boolean.op.subtract': 'Rozdíl',
      'boolean.op.intersect': 'Průnik',
      'boolean.targets': 'Cíle',
      'boolean.tools': 'Nástroje',
      'boolean.keepTools': 'Ponechat nástroje',
      'boolean.sameBody': 'Těleso {index} je zároveň cílem',
    });
    expect(booleanMessages.en).toEqual({
      'boolean.label': 'Boolean',
      'boolean.op': 'Operation',
      'boolean.op.union': 'Union',
      'boolean.op.subtract': 'Subtract',
      'boolean.op.intersect': 'Intersect',
      'boolean.targets': 'Targets',
      'boolean.tools': 'Tools',
      'boolean.keepTools': 'Keep tools',
      'boolean.sameBody': 'Body {index} is also a target',
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(booleanMessages)).toBe(true);
    expect(Object.isFrozen(booleanMessages.cs)).toBe(true);
    expect(Object.isFrozen(booleanMessages.en)).toBe(true);
  });
});

describe('booleanBuilder', () => {
  it('union merges the other targets and the tools into the first target', async () => {
    const { fake, kernel, calls } = aRecordingKernel();
    const state = await threeBoxes(kernel);
    const [a, b, c] = ['a', 'b', 'c'].map((f) => bodyOf(state, f).shape);

    const out = await build(
      aBoolean('u', { op: 'union', targets: [ref('a'), ref('c')], tools: [ref('b')] }),
      state,
      kernel,
    );

    expect(calls).toEqual([{ op: 'union', targets: [a], tools: [c, b] }]);
    expect(fake.callCount('boolean')).toBe(1);
    expect(await fake.boundingBox(bodyOf(out, 'a').shape)).toEqual({
      min: [0, 0, 0],
      max: [30, 15, 15],
    });
  });

  it('subtract passes all targets and all tools', async () => {
    const { fake, kernel, calls } = aRecordingKernel();
    const state = await threeBoxes(kernel);
    const [a, b, c] = ['a', 'b', 'c'].map((f) => bodyOf(state, f).shape);

    const out = await build(
      aBoolean('s', { op: 'subtract', targets: [ref('a'), ref('c')], tools: [ref('b')] }),
      state,
      kernel,
    );

    expect(calls).toEqual([{ op: 'subtract', targets: [a, c], tools: [b] }]);
    // The Fake subtracts nothing: the hull of the targets.
    expect(await fake.boundingBox(bodyOf(out, 'a').shape)).toEqual({
      min: [0, 0, 0],
      max: [30, 10, 10],
    });
  });

  it('intersect passes all targets and all tools', async () => {
    const { fake, kernel, calls } = aRecordingKernel();
    const state = await threeBoxes(kernel);
    const [a, b] = ['a', 'b'].map((f) => bodyOf(state, f).shape);

    const out = await build(
      aBoolean('i', { op: 'intersect', targets: [ref('a')], tools: [ref('b')] }),
      state,
      kernel,
    );

    expect(calls).toEqual([{ op: 'intersect', targets: [a], tools: [b] }]);
    expect(await fake.boundingBox(bodyOf(out, 'a').shape)).toEqual({
      min: [5, 5, 5],
      max: [10, 10, 10],
    });
  });

  it('the result keeps id, origin and names of the first target and is modified by the boolean', async () => {
    const { kernel } = aRecordingKernel();
    const state = await threeBoxes(kernel);
    const first = bodyOf(state, 'a');

    const out = await build(aBoolean('s', { op: 'subtract' }), state, kernel);

    const body = bodyOf(out, 'a');
    expect(body).toEqual({ ...first, shape: body.shape, lastModifiedBy: 's' });
    expect(body.names).toBe(first.names);
    expect(body.shape).not.toBe(first.shape);
    expect(Object.isFrozen(body)).toBe(true);
  });

  it('removes the other targets and the tools from the map', async () => {
    const { kernel } = aRecordingKernel();
    const state = await threeBoxes(kernel);

    const out = await build(
      aBoolean('u', { op: 'union', targets: [ref('a'), ref('b')], tools: [ref('c')] }),
      state,
      kernel,
    );

    expect([...out.artifacts.keys()]).toEqual(['a/body']);
  });

  it('with keepTools leaves the tools as they are, the same objects', async () => {
    const { kernel } = aRecordingKernel();
    const state = await threeBoxes(kernel);

    const out = await build(
      aBoolean('s', { op: 'subtract', targets: [ref('a')], tools: [ref('b')], keepTools: true }),
      state,
      kernel,
    );

    expect([...out.artifacts.keys()]).toEqual(['a/body', 'b/body', 'c/body']);
    expect(out.artifacts.get(bodyId('b' as FeatureId))).toBe(bodyOf(state, 'b'));
    expect(out.artifacts.get(bodyId('c' as FeatureId))).toBe(bodyOf(state, 'c'));
  });

  it('puts the result at the place of the first target in the map', async () => {
    const { kernel } = aRecordingKernel();
    const state = await threeBoxes(kernel);

    const out = await build(
      aBoolean('s', { op: 'subtract', targets: [ref('b')], tools: [ref('a')] }),
      state,
      kernel,
    );

    expect([...out.artifacts.keys()]).toEqual(['b/body', 'c/body']);
    expect(bodyOf(out, 'b').lastModifiedBy).toBe('s');
  });

  it('keeps the bodies it does not touch and does not change the input state', async () => {
    const { kernel } = aRecordingKernel();
    const state = await threeBoxes(kernel);
    const before = [...state.artifacts.entries()];

    const out = await build(aBoolean('s', { op: 'subtract' }), state, kernel);

    expect(out.artifacts.get(bodyId('c' as FeatureId))).toBe(bodyOf(state, 'c'));
    expect([...state.artifacts.entries()]).toEqual(before);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('an unresolved target gives UNRESOLVED_REFERENCE at targets without calling the kernel', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await threeBoxes(kernel);

    const output = await run(aBoolean('s', { targets: [ref('x')] }), state, kernel);

    if (output.ok) expect.fail('Expected an error');
    expect(output.error).toMatchObject({
      code: 'UNRESOLVED_REFERENCE',
      issues: [{ param: 'targets', code: 'param.unresolvedRef' }],
    });
    expect(fake.callCount('boolean')).toBe(0);
  });

  it('an unresolved tool gives UNRESOLVED_REFERENCE at tools', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await threeBoxes(kernel);

    const output = await run(aBoolean('s', { tools: [ref('b'), ref('x')] }), state, kernel);

    if (output.ok) expect.fail('Expected an error');
    expect(output.error).toMatchObject({
      code: 'UNRESOLVED_REFERENCE',
      issues: [{ param: 'tools', code: 'param.unresolvedRef' }],
    });
    expect(fake.callCount('boolean')).toBe(0);
  });

  it('lets an error of the kernel through', async () => {
    const { kernel } = aRecordingKernel();
    const state = await threeBoxes(kernel);

    await expect(
      run(aBoolean('i', { op: 'intersect', tools: [ref('c')] }), state, kernel),
    ).rejects.toMatchObject({ code: 'operation-failed' });
  });
});

// ---------------------------------------------------------------------------------------------
// In the Regenerator: a local test type 'block' (box at origin of size), because a plugin must
// not import another folder of features/*.

interface BlockParams {
  readonly origin: Vec3;
  readonly size: number;
}

const blockSchema: FeatureSchema<BlockParams> = {
  type: 'block',
  version: 1,
  label: 'block',
  params: {},
  defaults: () => ({ origin: [0, 0, 0], size: 10 }),
  validate: () => [],
};

const buildBlock: FeatureBuilder['build'] = async ({ feature, state }, { kernel }) => {
  // Only blocks of this file come here, all made by aBlock().
  const { origin, size } = feature.params as BlockParams;
  const { shape } = await kernel.makeBox({ origin, size: [size, size, size] });
  const id = bodyId(feature.id);
  const body: Body = Object.freeze({
    kind: 'body',
    id,
    origin: feature.id,
    lastModifiedBy: feature.id,
    shape,
    names: EMPTY_NAMES,
  });
  return { ok: true, state: Object.freeze({ artifacts: new Map(state.artifacts).set(id, body) }) };
};

function aBlock(id: string, origin: Vec3, size = 10): FeatureInstance<BlockParams> {
  return aFeature({ id, type: 'block', params: { origin, size } });
}

function aRegenerator() {
  const kernel = createFakeKernel();
  const schemas = createFeatureSchemaRegistry();
  const builders = createBuilderRegistry();
  schemas.register(blockSchema);
  builders.register(aSpyBuilder('block', buildBlock));
  registerPlugin(boolean.booleanPlugin, { schemas, builders, tools: createToolRegistry() });
  const regenerator = createRegenerator({ kernel, schemas, builders, now: stoppedClock });
  return { kernel, regenerator };
}

describe('boolean plugin in the Regenerator', () => {
  const k1 = aBlock('k1', [0, 0, 0]);
  const k2 = aBlock('k2', [5, 5, 5]);
  const cut = aBoolean('s', { op: 'subtract', targets: [ref('k1')], tools: [ref('k2')] });

  it('subtract of two blocks gives one body with the id of the first block', async () => {
    const { kernel, regenerator } = aRegenerator();
    const features = [k1, k2, cut];

    const r = result(await regenerator.run({ features, rollbackIndex: features.length }));

    expect(bodiesOf(r.finalState).map((b) => [b.id, b.origin, b.lastModifiedBy])).toEqual([
      ['k1/body', 'k1', 's'],
    ]);
    expect([...r.statuses.values()].map((s) => s.kind)).toEqual(['ok', 'ok', 'ok']);
    // Only the result stays alive; the blocks of k1 and k2 live in the cached states.
    expect(await kernel.liveHandleCount()).toBe(3);
  });

  it('a change of a param of the tool does not change the id of the result', async () => {
    const { regenerator } = aRegenerator();
    const first = result(await regenerator.run({ features: [k1, k2, cut], rollbackIndex: 3 }));
    const moved = aBlock('k2', [2, 2, 2], 4);

    const second = result(await regenerator.run({ features: [k1, moved, cut], rollbackIndex: 3 }));

    expect(bodiesOf(first.finalState).map((b) => b.id)).toEqual(['k1/body']);
    expect(bodiesOf(second.finalState).map((b) => b.id)).toEqual(['k1/body']);
  });

  it('a deleted tool gives UNRESOLVED_REFERENCE and leaves the first block as it is', async () => {
    const { regenerator } = aRegenerator();
    const features = [k1, cut];

    const r = result(await regenerator.run({ features, rollbackIndex: features.length }));

    expect(r.statuses.get(k1.id)).toEqual({ kind: 'ok' });
    expect(r.statuses.get(cut.id)).toMatchObject({
      kind: 'error',
      error: {
        code: 'UNRESOLVED_REFERENCE',
        issues: [{ param: 'tools', code: 'param.unresolvedRef' }],
      },
    });
    expect(bodiesOf(r.finalState).map((b) => [b.id, b.lastModifiedBy])).toEqual([
      ['k1/body', 'k1'],
    ]);
  });

  it('intersect of separate blocks is a KERNEL error and its state is not used', async () => {
    const { kernel, regenerator } = aRegenerator();
    const apart = aBlock('k2', [20, 0, 0]);
    const common = aBoolean('i', { op: 'intersect', targets: [ref('k1')], tools: [ref('k2')] });
    const features = [k1, apart, common];

    const r = result(await regenerator.run({ features, rollbackIndex: features.length }));

    expect(r.statuses.get(common.id)).toMatchObject({ kind: 'error', error: { code: 'KERNEL' } });
    expect(bodiesOf(r.finalState).map((b) => [b.id, b.lastModifiedBy])).toEqual([
      ['k1/body', 'k1'],
      ['k2/body', 'k2'],
    ]);
    // The failed intersect made no handle; only the two blocks live.
    expect(await kernel.liveHandleCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------

/** A FeatureEditor that records create calls; `open` pretends a session is already open. */
function aRecordingEditor(open = false) {
  const created: string[] = [];
  const session: FeatureEditSession = {
    mode: 'create',
    featureId: aFeature().id,
    schema: booleanSchema,
    state: new ObservableValue({
      params: {},
      issues: [],
      fields: [],
      activeRefParam: null,
      open: true,
      name: 'Boolean 1',
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
  registry.register(booleanTool);
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

describe('booleanTool', () => {
  it('is the modify tool boolean without a shortcut', () => {
    expect(booleanTool).toMatchObject({
      id: 'boolean',
      label: 'boolean.label',
      icon: 'layers-union',
      group: 'modify',
    });
    expect(booleanTool.shortcut).toBeUndefined();
  });

  it('labels the tool with a key the boolean messages translate (ADR 0014)', () => {
    expect(booleanMessages.cs[booleanTool.label]).toBe('Boolean');
    expect(booleanMessages.en[booleanTool.label]).toBe('Boolean');
  });

  it('opens the dialog for a new boolean and returns to the default tool', () => {
    const { editor, created } = aRecordingEditor();
    const { manager, emitted } = aToolManager(editor);

    manager.activate('boolean');

    expect(created).toEqual(['boolean']);
    expect(emitted).toEqual(['boolean', 'select']);
    expect(manager.active.get()).toBe('select');
  });

  it('only finishes while another session is open', () => {
    const { editor, created } = aRecordingEditor(true);
    const { manager, emitted } = aToolManager(editor);

    manager.activate('boolean');

    expect(created).toEqual([]);
    expect(emitted).toEqual(['boolean', 'select']);
  });

  it('creates a new tool on every activation', () => {
    expect(booleanTool.create()).not.toBe(booleanTool.create());
  });
});

// Keeps the EMPTY_STATE import honest: a boolean never runs on an empty studio without failing.
describe('booleanBuilder on an empty state', () => {
  it('fails on the unresolved first target', async () => {
    const output = await run(aBoolean('s'), EMPTY_STATE, createFakeKernel());
    if (output.ok) expect.fail('Expected an error');
    expect(output.error.issues).toEqual([{ param: 'targets', code: 'param.unresolvedRef' }]);
  });
});
