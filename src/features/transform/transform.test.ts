import { describe, expect, it } from 'vitest';
import { ObservableValue, createSequentialIdGenerator } from '@/core';
import type { Vec3 } from '@/core';
import {
  bodyId,
  createDocument,
  createFeatureSchemaRegistry,
  fromData,
  isParamVisible,
} from '@/document';
import type { BodyId, BodyRef, DocumentId, FeatureId, FeatureInstance, TopoName } from '@/document';
import { aFeature } from '@/document/testing';
import {
  SELECT_TOOL,
  createSelectionModel,
  createToolManager,
  createManipulatorRegistry,
  createToolRegistry,
} from '@/interaction';
import type {
  AngularHandle,
  FeatureEditor,
  FeatureEditSession,
  Handle,
  LinearHandle,
} from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import type { BoundingBox } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import type { FakeKernel } from '@/kernel/testing';
import { OP_VERSION, createOpHandlerRegistry, parseLogEntry, replayLog } from '@/ops';
import type { LogEntry } from '@/ops';
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
import { transformManipulators } from './manipulators';
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
    typeVersion: transformSchema.version,
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

function expectVec(actual: Vec3 | undefined, expected: Vec3): void {
  if (actual === undefined) expect.fail('No vector');
  for (let i = 0; i < 3; i++) {
    expect(actual[i], `[${String(i)}]`).toBeCloseTo(expected[i] ?? Number.NaN, 9);
  }
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
    expect(transform.transformPlugin.manipulators).toBe(transformManipulators);
    expect(transformManipulators.type).toBe('transform');
    expect(transformSchema.type).toBe('transform');
    expect(transformBuilder.type).toBe('transform');
  });

  it('registers schema, builder and tool through registerPlugin', () => {
    const regs = {
      schemas: createFeatureSchemaRegistry(),
      builders: createBuilderRegistry(),
      tools: createToolRegistry(),
      manipulators: createManipulatorRegistry(),
    };
    registerPlugin(transform.transformPlugin, regs);
    expect(regs.schemas.get('transform')).toBe(transformSchema);
    expect(regs.builders.get('transform')).toBe(transformBuilder);
    expect(regs.tools.get('transform')).toBe(transformTool);
    expect(regs.manipulators.get('transform')).toBe(transformManipulators);
  });
});

describe('transformSchema', () => {
  it('is version 2 of type transform with the icon arrows-move', () => {
    expect(transformSchema).toMatchObject({
      type: 'transform',
      version: 2,
      label: 'transform.label',
      icon: 'arrows-move',
    });
  });

  it('has the params bodies, pivot, pivotPoint, translate, axis, angle in this order', () => {
    expect(
      Object.entries(transformSchema.params).map(([key, spec]) => [key, spec.kind, spec.label]),
    ).toEqual([
      ['bodies', 'bodies', 'transform.bodies'],
      ['pivot', 'enum', 'transform.pivot'],
      ['pivotPoint', 'point', 'transform.pivotPoint'],
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

  it('pivot is bodiesCenter by default with the options bodiesCenter, origin, point', () => {
    expect(transformSchema.params['pivot']).toMatchObject({
      default: 'bodiesCenter',
      options: [
        { value: 'bodiesCenter', label: 'transform.pivot.bodiesCenter' },
        { value: 'origin', label: 'transform.pivot.origin' },
        { value: 'point', label: 'transform.pivot.point' },
      ],
    });
    expect(transformSchema.params['pivotPoint']).toMatchObject({ default: [0, 0, 0] });
  });

  it('shows pivotPoint only for the pivot point', () => {
    const spec = transformSchema.params['pivotPoint'];
    if (spec === undefined) expect.fail('No pivotPoint param');
    const params = transformSchema.defaults();
    expect(isParamVisible(spec, { ...params, pivot: 'point' })).toBe(true);
    expect(isParamVisible(spec, { ...params, pivot: 'origin' })).toBe(false);
    expect(isParamVisible(spec, { ...params, pivot: 'bodiesCenter' })).toBe(false);
    expect(isParamVisible(spec, {})).toBe(false);
  });

  it('does not check a hidden pivotPoint, checks a visible one', () => {
    const params = aTransform('t1').params;
    const broken = { ...params, pivotPoint: 'nowhere' };
    expect(transformSchema.validate({ ...broken, pivot: 'origin' })).toEqual([]);
    expect(transformSchema.validate({ ...broken, pivot: 'point' }).map((i) => i.param)).toEqual([
      'pivotPoint',
    ]);
  });

  it('rejects an unknown pivot', () => {
    expect(transformSchema.validate({ ...aTransform('t1').params, pivot: 'centroid' })).toEqual([
      { param: 'pivot', code: 'param.unknownOption' },
    ]);
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
    const pivotPoint = transformSchema.params['pivotPoint'];
    if (pivotPoint?.kind !== 'point') expect.fail('pivotPoint is not a point param');
    expect(Object.isFrozen(pivotPoint.default)).toBe(true);
    for (const key of ['axis', 'pivot']) {
      const spec = transformSchema.params[key];
      if (spec?.kind !== 'enum') expect.fail(`${key} is not an enum param`);
      expect(Object.isFrozen(spec.options), key).toBe(true);
      for (const option of spec.options) expect(Object.isFrozen(option), key).toBe(true);
    }
  });

  it('defaults move nothing: no body, pivot at the bodies center, no translation, axis z, angle 0', () => {
    expect(transformSchema.defaults()).toEqual({
      bodies: [],
      pivot: 'bodiesCenter',
      pivotPoint: [0, 0, 0],
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
    expect(a.pivotPoint).not.toBe(b.pivotPoint);
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

describe('transformSchema.migrate', () => {
  const v1 = {
    bodies: [ref('b1/body')],
    translate: [1, 2, 3],
    axis: 'x',
    angle: 0.5,
  };

  it('version 1 gets the pivot origin and pivotPoint [0, 0, 0], the other params stay', () => {
    const migrated = transformSchema.migrate?.(1, v1);

    expect(migrated).toEqual({ ...v1, pivot: 'origin', pivotPoint: [0, 0, 0] });
    expect(transformSchema.validate(migrated)).toEqual([]);
  });

  it('throws for an unknown version', () => {
    for (const version of [0, 2, 3]) {
      expect(() => transformSchema.migrate?.(version, v1), String(version)).toThrow(
        /transform.*version/,
      );
    }
  });

  it('throws for data of version 1 that are not an object', () => {
    for (const raw of [null, 42, 'params', [1, 2]]) {
      expect(() => transformSchema.migrate?.(1, raw), JSON.stringify(raw)).toThrow();
    }
  });

  it('fromData loads a feature of version 1 as version 2 with the pivot origin', () => {
    const schemas = createFeatureSchemaRegistry();
    schemas.register(transformSchema);
    const feature = { ...aTransform('t1'), typeVersion: 1, params: v1 };

    const loaded = fromData(
      {
        meta: { id: 'doc1', name: 'Old', createdAt: 0 },
        studio: { features: [feature], rollbackIndex: 1 },
      },
      schemas,
    );

    if (!loaded.ok) expect.fail(JSON.stringify(loaded.error));
    expect(loaded.value.studio.features).toMatchObject([
      { id: 't1', typeVersion: 2, params: { ...v1, pivot: 'origin', pivotPoint: [0, 0, 0] } },
    ]);
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
      'Střed otáčení',
      'Střed těles',
      'Počátek',
      'Bod',
      'Bod otáčení',
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
      'Pivot',
      'Bodies center',
      'Origin',
      'Point',
      'Pivot point',
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

  it('rotates by 90 degrees about z through the world origin with the pivot origin (as v1)', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);

    const next = await build(
      aTransform('t1', { pivot: 'origin', axis: 'z', angle: Math.PI / 2 }),
      state,
      kernel,
    );

    expectBox(await bboxOf(kernel, next, 'b1/body'), { min: [-4, 0, 0], max: [0, 2, 6] });
  });

  it.each([
    ['x', { min: [0, -6, 0], max: [2, 0, 4] }],
    ['y', { min: [0, 0, -2], max: [6, 4, 0] }],
  ] as const)('rotates by 90 degrees about %s', async (axis, expected) => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);

    const next = await build(
      aTransform('t1', { pivot: 'origin', axis, angle: Math.PI / 2 }),
      state,
      kernel,
    );

    expectBox(await bboxOf(kernel, next, 'b1/body'), {
      min: [...expected.min],
      max: [...expected.max],
    });
  });

  it('rotates first, then translates (T · R, not R · T)', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);

    const next = await build(
      aTransform('t1', { pivot: 'origin', translate: [10, 0, 0], axis: 'z', angle: Math.PI / 2 }),
      state,
      kernel,
    );

    // T · R: rotated to x in [-4, 0], y in [0, 2], then moved by 10 along x.
    // R · T would give x in [-4, 0], y in [10, 12].
    expectBox(await bboxOf(kernel, next, 'b1/body'), { min: [6, 0, 0], max: [10, 2, 6] });
  });

  it('bodiesCenter rotates about the center of the bounding box: the center stays', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [{ id: 'b1', origin: [10, 0, 0], size: [2, 2, 2] }]);

    const output = await transformBuilder.build(
      {
        feature: aTransform('t1', { pivot: 'bodiesCenter', axis: 'z', angle: Math.PI / 2 }),
        state,
      },
      aBuildContext(kernel, state),
    );

    if (!output.ok) expect.fail(output.error.message);
    expectBox(await bboxOf(kernel, output.state, 'b1/body'), { min: [10, 0, 0], max: [12, 2, 2] });
    expectVec(output.anchors?.['pivot']?.point, [11, 1, 1]);
  });

  it('point rotates about pivotPoint', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);

    const output = await transformBuilder.build(
      {
        feature: aTransform('t1', {
          pivot: 'point',
          pivotPoint: [0, 4, 0],
          axis: 'z',
          angle: Math.PI / 2,
        }),
        state,
      },
      aBuildContext(kernel, state),
    );

    if (!output.ok) expect.fail(output.error.message);
    // [0, 2] x [0, 4] about (0, 4): x in [0, 4], y in [4, 6].
    expectBox(await bboxOf(kernel, output.state, 'b1/body'), { min: [0, 4, 0], max: [4, 6, 6] });
    // pivotPoint is in the params, so there is no anchor (spec 07, the anchor is minimal).
    expect(output.anchors).toBeUndefined();
  });

  it('pivot, then translation: T(translate) · T(p) · R · T(-p)', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [{ id: 'b1', origin: [10, 0, 0], size: [2, 4, 2] }]);

    const next = await build(
      aTransform('t1', { translate: [0, 0, 5], axis: 'z', angle: Math.PI / 2 }),
      state,
      kernel,
    );

    // Center (11, 2, 1); rotated in place x in [9, 13], y in [1, 3], then up by 5.
    expectBox(await bboxOf(kernel, next, 'b1/body'), { min: [9, 1, 5], max: [13, 3, 7] });
  });

  it('gives the anchor only for bodiesCenter, not for origin or point', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);

    for (const pivot of ['origin', 'point'] as const) {
      const output = await transformBuilder.build(
        { feature: aTransform('t1', { pivot, pivotPoint: [7, 7, 7] }), state },
        aBuildContext(kernel, state),
      );
      if (!output.ok) expect.fail(output.error.message);
      expect(output.anchors, pivot).toBeUndefined();
    }
    const center = await transformBuilder.build(
      { feature: aTransform('t1', { pivot: 'bodiesCenter' }), state },
      aBuildContext(kernel, state),
    );
    if (!center.ok) expect.fail(center.error.message);
    expect(Object.keys(center.anchors ?? {})).toEqual(['pivot']);
  });

  it('the anchor pivot of two bodies is the center of their joined bounding box', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX, { id: 'b2', origin: [20, -2, 0], size: [2, 2, 10] }]);

    const output = await transformBuilder.build(
      { feature: aTransform('t1', { bodies: [ref('b1/body'), ref('b2/body')] }), state },
      aBuildContext(kernel, state),
    );

    if (!output.ok) expect.fail(output.error.message);
    // Joined box [0, -2, 0]–[22, 4, 10].
    expect(Object.keys(output.anchors ?? {})).toEqual(['pivot']);
    expectVec(output.anchors?.['pivot']?.point, [11, 1, 5]);
  });

  it('the anchor does not depend on translate or angle (spec 07, anchor invariant)', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);
    const anchorsOf = async (params: Partial<TransformParams>) => {
      const feature = aTransform('t1', { pivot: 'bodiesCenter', ...params });
      const output = await transformBuilder.build({ feature, state }, aBuildContext(kernel, state));
      if (!output.ok) expect.fail(output.error.message);
      return output.anchors;
    };

    const a = await anchorsOf({ translate: [0, 0, 0], angle: 0 });
    const b = await anchorsOf({ translate: [5, -3, 9], axis: 'x', angle: 1.2 });

    expect(b).toEqual(a);
    expectVec(a?.['pivot']?.point, [1, 2, 3]);
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
      manipulators: createManipulatorRegistry(),
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

  it('a log of version 1 replays to version 2 with the pivot origin and builds as before', async () => {
    const { kernel, schemas, regenerator } = aSetup();
    const handlers = createOpHandlerRegistry({ schemas });
    const box = aFeature({ id: 'b1', params: { size: 2 } });
    const v1 = { bodies: [ref('b1/body')], translate: [0, 0, 0], axis: 'z', angle: 0 };
    const t1 = { id: 't1', type: 'transform', typeVersion: 1, name: 'T', suppressed: false };
    const rotated = { ...v1, angle: Math.PI / 2 };
    const moved = { ...rotated, translate: [10, 0, 0] };
    // Raw entries as stored before M18: feature.add with typeVersion 1 inside the feature,
    // feature.setParams of the current version with typeVersion 1 and one from before M10.1.
    const raw = [
      { op: { type: 'feature.add', v: 1, feature: box, index: 0 } },
      { op: { type: 'feature.add', v: 1, feature: { ...t1, params: v1 }, index: 1 } },
      {
        op: {
          type: 'feature.setParams',
          v: OP_VERSION['feature.setParams'],
          featureId: 't1',
          typeVersion: 1,
          params: rotated,
        },
      },
      { op: { type: 'feature.setParams', v: 1, featureId: 't1', params: moved } },
    ].map((entry, i) => ({
      ...entry,
      seq: i + 1,
      kind: 'do',
      // The inverse is not replayed; any valid operation does.
      inverse: { type: 'feature.remove', v: 1, featureId: 't1' },
      label: 'old',
      time: 0,
    }));
    const entries: LogEntry[] = raw.map((entry) => {
      const parsed = parseLogEntry(handlers, entry);
      if (!parsed.ok) expect.fail(JSON.stringify(parsed.error));
      return parsed.value;
    });
    const doc = createDocument({
      meta: { id: 'doc1' as DocumentId, name: 'Old', createdAt: 0 }, // a test id is trusted
    });

    replayLog(doc, handlers, entries);

    const feature = doc.studio.features.find((f) => f.id === 't1');
    expect(feature).toMatchObject({
      typeVersion: 2,
      params: { ...moved, pivot: 'origin', pivotPoint: [0, 0, 0] },
    });
    const r = result(await regenerator.run({ features: doc.studio.features, rollbackIndex: 2 }));
    expect(r.statuses.get('t1' as FeatureId)).toEqual({ kind: 'ok' });
    // As in version 1: rotated about z through the origin to x in [-2, 0], then by 10 along x.
    expectBox(await bboxOf(kernel, r.finalState, 'b1/body'), { min: [8, 0, 0], max: [10, 2, 2] });
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

describe('transformManipulators', () => {
  const ANCHORS = { pivot: { point: [1, 2, 3] as Vec3 } };
  const params = (overrides: Partial<TransformParams> = {}): TransformParams => ({
    ...aTransform('t1').params,
    pivot: 'bodiesCenter',
    translate: [10, 20, 30],
    axis: 'z',
    angle: 0.7,
    ...overrides,
  });

  function handle(handles: readonly Handle[], id: string): Handle {
    const found = handles.find((h) => h.id === id);
    if (found === undefined) expect.fail(`No handle ${id}`);
    return found;
  }
  function linear(handles: readonly Handle[], id: string): LinearHandle {
    const h = handle(handles, id);
    if (h.kind !== 'linear') expect.fail(`${id} is not linear`);
    return h;
  }
  function angular(handles: readonly Handle[], id: string): AngularHandle {
    const h = handle(handles, id);
    if (h.kind !== 'angular') expect.fail(`${id} is not angular`);
    return h;
  }

  it('bodiesCenter gives no handles without the anchor pivot', () => {
    expect(transformManipulators.handles(params(), {})).toEqual([]);
  });

  it('origin: the handles stand at translate without any anchor', () => {
    const handles = transformManipulators.handles(params({ pivot: 'origin' }), {});
    expect(handles).toHaveLength(6);
    expect(linear(handles, 'tx').position).toEqual([10, 20, 30]);
    expect(angular(handles, 'rz').center).toEqual([10, 20, 30]);
  });

  it('point: the handles stand at pivotPoint + translate without any anchor', () => {
    const p = params({ pivot: 'point', pivotPoint: [-1, 0, 2] });
    const handles = transformManipulators.handles(p, {});
    expect(handles).toHaveLength(6);
    expect(linear(handles, 'tz').position).toEqual([9, 20, 32]);
    expect(angular(handles, 'rx').center).toEqual([9, 20, 32]);
  });

  it('origin and point ignore a stale anchor pivot', () => {
    const origin = transformManipulators.handles(params({ pivot: 'origin' }), ANCHORS);
    expect(linear(origin, 'tx').position).toEqual([10, 20, 30]);
    const point = transformManipulators.handles(
      params({ pivot: 'point', pivotPoint: [-1, 0, 2] }),
      ANCHORS,
    );
    expect(linear(point, 'tx').position).toEqual([9, 20, 32]);
  });

  it('gives six handles tx, ty, tz, rx, ry, rz', () => {
    const handles = transformManipulators.handles(params(), ANCHORS);
    expect(handles.map((h) => [h.id, h.kind, h.unit, h.tint])).toEqual([
      ['tx', 'linear', 'length', 'x'],
      ['ty', 'linear', 'length', 'y'],
      ['tz', 'linear', 'length', 'z'],
      ['rx', 'angular', 'angle', 'x'],
      ['ry', 'angular', 'angle', 'y'],
      ['rz', 'angular', 'angle', 'z'],
    ]);
  });

  it('arrows stand at pivot + translate along the world axes with the translate values', () => {
    const handles = transformManipulators.handles(params(), ANCHORS);
    const expected: readonly [string, Vec3, number][] = [
      ['tx', [1, 0, 0], 10],
      ['ty', [0, 1, 0], 20],
      ['tz', [0, 0, 1], 30],
    ];
    for (const [id, direction, value] of expected) {
      const h = linear(handles, id);
      expect(h.position, id).toEqual([11, 22, 33]);
      expect(h.direction, id).toEqual(direction);
      expect(h.value, id).toBe(value);
    }
  });

  it('toParams of ty changes only the y of translate', () => {
    const ty = linear(transformManipulators.handles(params(), ANCHORS), 'ty');
    expect(ty.toParams(-4)).toEqual({ translate: [10, -4, 30] });
  });

  it('rings stand at pivot + translate about the world axes with zero Y, Z, X', () => {
    const handles = transformManipulators.handles(params(), ANCHORS);
    const expected: readonly [string, Vec3, Vec3][] = [
      ['rx', [1, 0, 0], [0, 1, 0]],
      ['ry', [0, 1, 0], [0, 0, 1]],
      ['rz', [0, 0, 1], [1, 0, 0]],
    ];
    for (const [id, axis, zero] of expected) {
      const h = angular(handles, id);
      expect(h.center, id).toEqual([11, 22, 33]);
      expect(h.axis, id).toEqual(axis);
      expect(h.zero, id).toEqual(zero);
    }
  });

  it('the ring of the current axis has the angle, the others 0 and switch the axis', () => {
    const handles = transformManipulators.handles(params({ axis: 'z', angle: 0.7 }), ANCHORS);
    expect(angular(handles, 'rz').value).toBe(0.7);
    expect(angular(handles, 'rx').value).toBe(0);
    expect(angular(handles, 'ry').value).toBe(0);
    expect(angular(handles, 'rx').toParams(0.3)).toEqual({ axis: 'x', angle: 0.3 });
    expect(angular(handles, 'rz').toParams(1.1)).toEqual({ axis: 'z', angle: 1.1 });
  });

  it('the handles are frozen', () => {
    const handles = transformManipulators.handles(params(), ANCHORS);
    expect(Object.isFrozen(handles)).toBe(true);
    for (const h of handles) expect(Object.isFrozen(h), h.id).toBe(true);
    expect(Object.isFrozen(linear(handles, 'tx').position)).toBe(true);
    expect(Object.isFrozen(angular(handles, 'rx').center)).toBe(true);
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
