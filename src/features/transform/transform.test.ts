import { describe, expect, it } from 'vitest';
import { ObservableValue, createSequentialIdGenerator } from '@/core';
import type { Vec3 } from '@/core';
import { bodyId, createFeatureSchemaRegistry } from '@/document';
import type { BodyId, BodyRef, FeatureId, FeatureInstance, TopoName } from '@/document';
import { aFeature } from '@/document/testing';
import {
  SELECT_TOOL,
  createSelectionModel,
  createToolManager,
  createToolRegistry,
} from '@/interaction';
import type { FeatureEditor, FeatureEditSession } from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import type { BoundingBox } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import type { FakeKernel } from '@/kernel/testing';
import { anOpsSession } from '@/ops/testing';
import { registerPlugin } from '@/plugin-api';
import { EMPTY_STATE, bodiesOf, createBuilderRegistry, nameShape } from '@/regen';
import type { Artifact, Body, RegenState } from '@/regen';
import { aBuildContext, aRegenSetup, resized, result } from '@/regen/testing';
import { transformBuilder } from './builder';
import { transformSchema } from './schema';
import type { TransformParams } from './schema';
import { transformMessages } from './messages';
import { transformTool } from './tool';
import * as transform from '.';

function ref(body: string): BodyRef {
  // Test data: the id has the shape bodyId mints, the document checks it at its boundary.
  return { kind: 'body', body: body as BodyId };
}

function topo(name: string): TopoName {
  // Test data: the name as propagateNames mints it for the box.
  return name as TopoName;
}

function aTransform(
  id: string,
  params: Partial<TransformParams> = {},
): FeatureInstance<TransformParams> {
  return aFeature({
    id,
    type: 'transform',
    params: { ...transformSchema.defaults(), bodies: [ref('b1/body')], ...params },
  });
}

/** A state with one box body per entry, each created and named by its own feature `<id>`. */
async function aState(
  kernel: FakeKernel,
  boxes: readonly { readonly id: string; readonly origin: Vec3; readonly size: Vec3 }[],
): Promise<RegenState> {
  const artifacts = new Map<BodyId, Artifact>();
  for (const box of boxes) {
    const result = await kernel.makeBox({ origin: box.origin, size: box.size });
    const feature = box.id as FeatureId;
    // Named like the box builder names it, so the transform has names to carry over.
    const names = await nameShape({ kernel, featureId: feature, result, inputs: [] });
    const id = bodyId(feature);
    artifacts.set(
      id,
      Object.freeze<Body>({
        kind: 'body',
        id,
        origin: feature,
        lastModifiedBy: feature,
        shape: result.shape,
        names,
      }),
    );
  }
  return Object.freeze({ artifacts });
}

async function build(
  feature: FeatureInstance<TransformParams>,
  state: RegenState,
  kernel: FakeKernel,
): Promise<RegenState> {
  const output = await transformBuilder.build({ feature, state }, aBuildContext(kernel, state));
  if (!output.ok) expect.fail(`Unexpected build error: ${output.error.message}`);
  return output.state;
}

async function bboxOf(kernel: FakeKernel, state: RegenState, id: string): Promise<BoundingBox> {
  const body = state.artifacts.get(id as BodyId);
  if (body?.kind !== 'body') expect.fail(`No body ${id}`);
  return kernel.boundingBox(body.shape);
}

function expectBox(actual: BoundingBox, expected: { min: Vec3; max: Vec3 }): void {
  for (let i = 0; i < 3; i++) {
    expect(actual.min[i], `min[${String(i)}]`).toBeCloseTo(expected.min[i] ?? Number.NaN, 9);
    expect(actual.max[i], `max[${String(i)}]`).toBeCloseTo(expected.max[i] ?? Number.NaN, 9);
  }
}

describe('transform public API', () => {
  it('exports exactly transformPlugin', () => {
    expect(Object.keys(transform)).toEqual(['transformPlugin']);
  });

  it('transformPlugin joins the schema, builder, messages and tool of type transform', () => {
    expect(transform.transformPlugin.schema).toBe(transformSchema);
    expect(transform.transformPlugin.builder).toBe(transformBuilder);
    expect(transform.transformPlugin.messages).toBe(transformMessages);
    expect(transform.transformPlugin.tools).toEqual([transformTool]);
    expect(transformSchema.type).toBe('transform');
    expect(transformBuilder.type).toBe('transform');
  });

  it('registers schema, builder and tool through registerPlugin', () => {
    const regs = {
      schemas: createFeatureSchemaRegistry(),
      builders: createBuilderRegistry(),
      tools: createToolRegistry(),
    };
    registerPlugin(transform.transformPlugin, regs);
    expect(regs.schemas.get('transform')).toBe(transformSchema);
    expect(regs.builders.get('transform')).toBe(transformBuilder);
    expect(regs.tools.get('transform')).toBe(transformTool);
  });
});

describe('transformSchema', () => {
  it('is version 1 of type transform with the icon arrows-move', () => {
    expect(transformSchema).toMatchObject({
      type: 'transform',
      version: 1,
      label: 'transform.label',
      icon: 'arrows-move',
    });
  });

  it('has the params bodies, translate, axis, angle in this order with translation keys', () => {
    expect(
      Object.entries(transformSchema.params).map(([key, spec]) => [key, spec.kind, spec.label]),
    ).toEqual([
      ['bodies', 'bodies', 'transform.bodies'],
      ['translate', 'point', 'transform.translate'],
      ['axis', 'enum', 'transform.axis'],
      ['angle', 'angle', 'transform.angle'],
    ]);
  });

  it('asks for at least one body, the axis x/y/z and an unbounded angle', () => {
    expect(transformSchema.params['bodies']).toMatchObject({ min: 1 });
    expect(transformSchema.params['bodies']).not.toHaveProperty('max');
    expect(transformSchema.params['axis']).toMatchObject({
      default: 'z',
      options: [
        { value: 'x', label: 'transform.axis.x' },
        { value: 'y', label: 'transform.axis.y' },
        { value: 'z', label: 'transform.axis.z' },
      ],
    });
    const angle = transformSchema.params['angle'];
    expect(angle).toEqual({ kind: 'angle', label: 'transform.angle', default: 0 });
  });

  it('is frozen deeply', () => {
    expect(Object.isFrozen(transformSchema)).toBe(true);
    expect(Object.isFrozen(transformSchema.params)).toBe(true);
    for (const [key, spec] of Object.entries(transformSchema.params)) {
      expect(Object.isFrozen(spec), key).toBe(true);
    }
    const translate = transformSchema.params['translate'];
    if (translate?.kind !== 'point') expect.fail('translate is not a point param');
    expect(Object.isFrozen(translate.default)).toBe(true);
    const axis = transformSchema.params['axis'];
    if (axis?.kind !== 'enum') expect.fail('axis is not an enum param');
    expect(Object.isFrozen(axis.options)).toBe(true);
    for (const option of axis.options) expect(Object.isFrozen(option)).toBe(true);
  });

  it('defaults move nothing: no body, no translation, axis z, angle 0', () => {
    expect(transformSchema.defaults()).toEqual({
      bodies: [],
      translate: [0, 0, 0],
      axis: 'z',
      angle: 0,
    });
  });

  it('defaults pass validation once a body is picked; without one only tooFewRefs', () => {
    const defaults = transformSchema.defaults();
    expect(transformSchema.validate({ ...defaults, bodies: [ref('b1/body')] })).toEqual([]);
    expect(transformSchema.validate(defaults)).toEqual([
      { param: 'bodies', code: 'param.tooFewRefs', params: { min: 1 } },
    ]);
  });

  it('defaults returns a new object every call', () => {
    const a = transformSchema.defaults();
    const b = transformSchema.defaults();
    expect(a).not.toBe(b);
    expect(a.bodies).not.toBe(b.bodies);
    expect(a.translate).not.toBe(b.translate);
    expect(a).toEqual(b);
  });

  it('accepts any finite angle, negative and above a full turn', () => {
    for (const angle of [-10, 7, -Math.PI, 4 * Math.PI]) {
      expect(transformSchema.validate(aTransform('t1', { angle }).params), String(angle)).toEqual(
        [],
      );
    }
  });

  it('rejects a NaN or infinite angle', () => {
    for (const angle of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(transformSchema.validate(aTransform('t1', { angle }).params)).toEqual([
        { param: 'angle', code: 'param.wrongType' },
      ]);
    }
  });

  it('rejects an unknown axis', () => {
    const params = { ...aTransform('t1').params, axis: 'w' };
    expect(transformSchema.validate(params)).toEqual([
      { param: 'axis', code: 'param.unknownOption' },
    ]);
  });

  it.each([[[0, 0]], [[0, 0, Number.NaN]], ['0,0,0'], [undefined]])(
    'rejects translate %j',
    (translate) => {
      const params = { ...aTransform('t1').params, translate };
      expect(transformSchema.validate(params).map((i) => i.param)).toEqual(['translate']);
    },
  );

  it('rejects the same body twice and an invalid reference', () => {
    const twice = aTransform('t1', { bodies: [ref('b1/body'), ref('b1/body')] }).params;
    expect(transformSchema.validate(twice)).toEqual([
      { param: 'bodies', code: 'param.duplicateRef', params: { index: 1 } },
    ]);
    const invalid = { ...aTransform('t1').params, bodies: [{ kind: 'body' }] };
    expect(transformSchema.validate(invalid)).toEqual([
      { param: 'bodies', code: 'param.invalidRef', params: { index: 0 } },
    ]);
  });

  it('rejects params that are not an object, missing and unexpected params', () => {
    expect(transformSchema.validate(null)).not.toEqual([]);
    const withoutAngle = Object.fromEntries(
      Object.entries(aTransform('t1').params).filter(([key]) => key !== 'angle'),
    );
    expect(transformSchema.validate(withoutAngle).map((i) => i.param)).toEqual(['angle']);
    const extra = { ...aTransform('t1').params, scale: 2 };
    expect(transformSchema.validate(extra).map((i) => i.param)).toEqual(['scale']);
  });
});

describe('transformMessages', () => {
  /** Every translation key of the schema: its label, the param labels and enum option labels. */
  function schemaKeys(): readonly string[] {
    return [
      transformSchema.label,
      ...Object.values(transformSchema.params).flatMap((spec) => [
        spec.label,
        ...(spec.kind === 'enum' ? spec.options.map((o) => o.label) : []),
      ]),
    ];
  }

  it.each(['cs', 'en'] as const)('%s has a text for every key of the schema', (lang) => {
    for (const key of schemaKeys()) {
      expect(transformMessages[lang][key], `${lang}: ${key}`).toEqual(expect.any(String));
      expect(transformMessages[lang][key], `${lang}: ${key}`).not.toBe('');
    }
  });

  it('cs and en have the same keys', () => {
    expect(Object.keys(transformMessages.cs).sort()).toEqual(
      Object.keys(transformMessages.en).sort(),
    );
  });

  it('has the texts of the plan', () => {
    const texts = (lang: 'cs' | 'en') => schemaKeys().map((key) => transformMessages[lang][key]);
    expect(texts('cs')).toEqual([
      'Transformace',
      'Tělesa',
      'Posun',
      'Osa rotace',
      'X',
      'Y',
      'Z',
      'Úhel',
    ]);
    expect(texts('en')).toEqual([
      'Transform',
      'Bodies',
      'Translation',
      'Rotation axis',
      'X',
      'Y',
      'Z',
      'Angle',
    ]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(transformMessages)).toBe(true);
    expect(Object.isFrozen(transformMessages.cs)).toBe(true);
    expect(Object.isFrozen(transformMessages.en)).toBe(true);
  });
});

describe('transformBuilder', () => {
  const BOX = { id: 'b1', origin: [0, 0, 0] as Vec3, size: [2, 4, 6] as Vec3 };

  it('translates a box: the bbox moves, id, origin and names stay, lastModifiedBy is the transform', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);
    const before = state.artifacts.get('b1/body' as BodyId);

    const next = await build(aTransform('t1', { translate: [10, 20, 30] }), state, kernel);

    expect([...next.artifacts.keys()]).toEqual(['b1/body']);
    const after = next.artifacts.get('b1/body' as BodyId);
    expect(after).toMatchObject({
      kind: 'body',
      id: 'b1/body',
      origin: 'b1',
      lastModifiedBy: 't1',
    });
    if (after?.kind !== 'body' || before?.kind !== 'body') expect.fail('No body b1/body');
    // nameShape over the identity history of the transform: the same names on the same faces.
    expect(after.names).not.toBe(before.names);
    expect([...after.names.faceEntries]).toEqual([...before.names.faceEntries]);
    expect([...after.names.edgeEntries]).toEqual([...before.names.edgeEntries]);
    expect(after.names.faces(topo('b1/face:top'))).toEqual([5]);
    expect(after.shape).not.toBe(before.shape);
    expectBox(await bboxOf(kernel, next, 'b1/body'), { min: [10, 20, 30], max: [12, 24, 36] });
  });

  it('rotates by 90 degrees about z through the world origin', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);

    const next = await build(aTransform('t1', { axis: 'z', angle: Math.PI / 2 }), state, kernel);

    expectBox(await bboxOf(kernel, next, 'b1/body'), { min: [-4, 0, 0], max: [0, 2, 6] });
  });

  it.each([
    ['x', { min: [0, -6, 0], max: [2, 0, 4] }],
    ['y', { min: [0, 0, -2], max: [6, 4, 0] }],
  ] as const)('rotates by 90 degrees about %s', async (axis, expected) => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);

    const next = await build(aTransform('t1', { axis, angle: Math.PI / 2 }), state, kernel);

    expectBox(await bboxOf(kernel, next, 'b1/body'), {
      min: [...expected.min],
      max: [...expected.max],
    });
  });

  it('rotates first, then translates (T · R, not R · T)', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);

    const next = await build(
      aTransform('t1', { translate: [10, 0, 0], axis: 'z', angle: Math.PI / 2 }),
      state,
      kernel,
    );

    // T · R: rotated to x in [-4, 0], y in [0, 2], then moved by 10 along x.
    // R · T would give x in [-4, 0], y in [10, 12].
    expectBox(await bboxOf(kernel, next, 'b1/body'), { min: [6, 0, 0], max: [10, 2, 6] });
  });

  it('moves two bodies at once, both keep their id and place in the map', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [
      BOX,
      { id: 'b2', origin: [20, 0, 0], size: [1, 1, 1] },
      { id: 'b3', origin: [40, 0, 0], size: [1, 1, 1] },
    ]);
    const untouched = state.artifacts.get('b2/body' as BodyId);

    const next = await build(
      aTransform('t1', { bodies: [ref('b3/body'), ref('b1/body')], translate: [0, 0, 5] }),
      state,
      kernel,
    );

    expect([...next.artifacts.keys()]).toEqual(['b1/body', 'b2/body', 'b3/body']);
    expect(next.artifacts.get('b2/body' as BodyId)).toBe(untouched);
    for (const id of ['b1/body', 'b3/body']) {
      expect(next.artifacts.get(id as BodyId), id).toMatchObject({ id, lastModifiedBy: 't1' });
    }
    expectBox(await bboxOf(kernel, next, 'b1/body'), { min: [0, 0, 5], max: [2, 4, 11] });
    expectBox(await bboxOf(kernel, next, 'b3/body'), { min: [40, 0, 5], max: [41, 1, 6] });
    expect(kernel.callCount('transform')).toBe(2);
  });

  it('keeps the input state as it is and freezes the output state and the moved body', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);
    const before = state.artifacts.get('b1/body' as BodyId);

    const next = await build(aTransform('t1', { translate: [1, 0, 0] }), state, kernel);

    expect(state.artifacts.get('b1/body' as BodyId)).toBe(before);
    expectBox(await bboxOf(kernel, state, 'b1/body'), { min: [0, 0, 0], max: [2, 4, 6] });
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.artifacts.get('b1/body' as BodyId))).toBe(true);
  });

  it('an unresolved reference gives UNRESOLVED_REFERENCE at bodies and calls no kernel op', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);
    const calls = kernel.callCount();
    const feature = aTransform('t1', { bodies: [ref('b1/body'), ref('gone/body')] });

    const output = await transformBuilder.build({ feature, state }, aBuildContext(kernel, state));

    if (output.ok) expect.fail('Expected an unresolved reference');
    expect(output.error).toMatchObject({
      code: 'UNRESOLVED_REFERENCE',
      issues: [{ param: 'bodies', code: 'param.unresolvedRef' }],
    });
    expect(kernel.callCount()).toBe(calls);
  });

  it('lets a kernel error fly', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);
    kernel.failNext('transform', 'operation-failed');

    await expect(
      transformBuilder.build({ feature: aTransform('t1'), state }, aBuildContext(kernel, state)),
    ).rejects.toMatchObject({ code: 'operation-failed' });
  });

  it('an empty body list is rejected by the validation', () => {
    expect(transformSchema.validate(aTransform('t1', { bodies: [] }).params)).toEqual([
      { param: 'bodies', code: 'param.tooFewRefs', params: { min: 1 } },
    ]);
  });

  it('on an empty state the reference is unresolved', async () => {
    const kernel = createFakeKernel();
    const output = await transformBuilder.build(
      { feature: aTransform('t1'), state: EMPTY_STATE },
      aBuildContext(kernel, EMPTY_STATE),
    );
    expect(output.ok).toBe(false);
  });
});

describe('transform plugin in the Regenerator', () => {
  function aSetup() {
    const setup = aRegenSetup();
    registerPlugin(transform.transformPlugin, {
      schemas: setup.schemas,
      builders: setup.builders,
      tools: createToolRegistry(),
    });
    return setup;
  }

  it('box + transform give one body b1/body last modified by the transform', async () => {
    const { kernel, regenerator } = aSetup();
    const box = aFeature({ id: 'b1' });
    const moved = aTransform('t1', { translate: [5, 0, 0] });
    const list = [box, moved];

    const r = result(await regenerator.run({ features: list, rollbackIndex: list.length }));

    const bodies: readonly Body[] = bodiesOf(r.finalState);
    expect(bodies.map((b) => [b.id, b.origin, b.lastModifiedBy])).toEqual([
      ['b1/body', 'b1', 't1'],
    ]);
    expect(r.statuses.get(moved.id)).toEqual({ kind: 'ok' });
    expectBox(await bboxOf(kernel, r.finalState, 'b1/body'), { min: [5, 0, 0], max: [6, 1, 1] });
  });

  it('a change of the box param keeps the id of the moved body', async () => {
    const { regenerator } = aSetup();
    const box = aFeature({ id: 'b1' });
    const moved = aTransform('t1', { translate: [5, 0, 0] });

    const first = result(await regenerator.run({ features: [box, moved], rollbackIndex: 2 }));
    const second = result(
      await regenerator.run({ features: [resized(box, 3), moved], rollbackIndex: 2 }),
    );

    expect(bodiesOf(first.finalState).map((b) => b.id)).toEqual(['b1/body']);
    expect(bodiesOf(second.finalState).map((b) => [b.id, b.lastModifiedBy])).toEqual([
      ['b1/body', 't1'],
    ]);
  });

  it('an unresolved reference is an error status and the state passes on unchanged', async () => {
    const { kernel, regenerator } = aSetup();
    const box = aFeature({ id: 'b1' });
    const moved = aTransform('t1', { bodies: [ref('gone/body')], translate: [5, 0, 0] });

    const r = result(await regenerator.run({ features: [box, moved], rollbackIndex: 2 }));

    expect(r.statuses.get(moved.id)).toMatchObject({
      kind: 'error',
      error: {
        code: 'UNRESOLVED_REFERENCE',
        issues: [{ param: 'bodies', code: 'param.unresolvedRef' }],
      },
    });
    expect(bodiesOf(r.finalState).map((b) => [b.id, b.lastModifiedBy])).toEqual([
      ['b1/body', 'b1'],
    ]);
    expectBox(await bboxOf(kernel, r.finalState, 'b1/body'), { min: [0, 0, 0], max: [1, 1, 1] });
  });

  it('an empty body list is a validation error of the feature', async () => {
    const { regenerator } = aSetup();
    const box = aFeature({ id: 'b1' });
    const moved = aTransform('t1', { bodies: [] });

    const r = result(await regenerator.run({ features: [box, moved], rollbackIndex: 2 }));

    expect(r.statuses.get(moved.id)).toMatchObject({ kind: 'error' });
    expect(JSON.stringify(r.statuses.get(moved.id))).toContain('param.tooFewRefs');
  });
});

/** A FeatureEditor that records create calls; `open` pretends a session is already open. */
function aRecordingEditor(open = false) {
  const created: string[] = [];
  const session: FeatureEditSession = {
    mode: 'create',
    featureId: aFeature().id,
    schema: transformSchema,
    state: new ObservableValue({
      params: {},
      issues: [],
      fields: [],
      activeRefParam: null,
      open: true,
      name: 'Transform 1',
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
  registry.register(transformTool);
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

describe('transformTool', () => {
  it('is the modify tool transform without a shortcut', () => {
    expect(transformTool).toMatchObject({
      id: 'transform',
      label: 'transform.label',
      icon: 'arrows-move',
      group: 'modify',
    });
    expect(transformTool.shortcut).toBeUndefined();
  });

  it('labels the tool with a key the transform messages translate (ADR 0014)', () => {
    expect(transformMessages.cs[transformTool.label]).toBe('Transformace');
    expect(transformMessages.en[transformTool.label]).toBe('Transform');
  });

  it('opens the dialog for a new transform and returns to the default tool', () => {
    const { editor, created } = aRecordingEditor();
    const { manager, emitted } = aToolManager(editor);

    manager.activate('transform');

    expect(created).toEqual(['transform']);
    expect(emitted).toEqual(['transform', 'select']);
    expect(manager.active.get()).toBe('select');
  });

  it('only finishes while another session is open', () => {
    const { editor, created } = aRecordingEditor(true);
    const { manager, emitted } = aToolManager(editor);

    manager.activate('transform');

    expect(created).toEqual([]);
    expect(emitted).toEqual(['transform', 'select']);
  });

  it('creates a new tool on every activation', () => {
    expect(transformTool.create()).not.toBe(transformTool.create());
  });
});
