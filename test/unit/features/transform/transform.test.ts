import { describe, expect, it } from 'vitest';
import { ObservableValue, createSequentialIdGenerator, mat4, vec3 } from '@/core';
import type { Vec3 } from '@/core';
import {
  bodyId,
  createDocument,
  createFeatureSchemaRegistry,
  fromData,
  isParamVisible,
} from '@/document';
import type { BodyId, BodyRef, DocumentId, FeatureId, FeatureInstance, TopoName } from '@/document';
import { aFeature, anEvaluated } from '@/document/testing';
import {
  SELECT_TOOL,
  createSelectionModel,
  createToolManager,
  createManipulatorRegistry,
  createToolRegistry,
} from '@/interaction';
import type {
  AngularHandle,
  FeatureAnchors,
  FeatureEditor,
  FeatureEditSession,
  Handle,
  LinearHandle,
  ManipulatorFrame,
  PlanarHandle,
  PointHandle,
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
import { aBuildContext, aBuildInput, aRegenSetup, resized, result } from '@/regen/testing';
import { transformBuilder } from '@/features/transform/builder';
import { transformSchema } from '@/features/transform/schema';
import type { TransformParams } from '@/features/transform/schema';
import { transformMessages } from '@/features/transform/messages';
import { transformTool } from '@/features/transform/tool';
import { transformManipulators } from '@/features/transform/manipulators';
import * as transform from '@/features/transform';

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
  const output = await transformBuilder.build(
    aBuildInput(feature, state),
    aBuildContext(kernel, state),
  );
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
  const ANGLES = ['rx', 'ry', 'rz'] as const;

  it('is version 3 of type transform with the icon arrows-move', () => {
    expect(transformSchema).toMatchObject({
      type: 'transform',
      version: 3,
      label: 'transform.label',
      icon: 'arrows-move',
    });
  });

  it('has the params bodies, pivot, pivotPoint, translate, rx, ry, rz in this order', () => {
    expect(
      Object.entries(transformSchema.params).map(([key, spec]) => [key, spec.kind, spec.label]),
    ).toEqual([
      ['bodies', 'bodies', 'transform.bodies'],
      ['pivot', 'enum', 'transform.pivot'],
      ['pivotPoint', 'point', 'transform.pivotPoint'],
      ['translate', 'point', 'transform.translate'],
      ['rx', 'angle', 'transform.rx'],
      ['ry', 'angle', 'transform.ry'],
      ['rz', 'angle', 'transform.rz'],
    ]);
  });

  it('asks for at least one body and three unbounded angles with the default 0', () => {
    expect(transformSchema.params['bodies']).toMatchObject({ min: 1 });
    expect(transformSchema.params['bodies']).not.toHaveProperty('max');
    for (const key of ANGLES) {
      expect(transformSchema.params[key], key).toEqual({
        kind: 'angle',
        label: `transform.${key}`,
        default: 0,
      });
    }
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
    const spec = transformSchema.params.pivotPoint;
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
    if (translate.kind !== 'point') expect.fail('translate is not a point param');
    expect(Object.isFrozen(translate.default)).toBe(true);
    const pivotPoint = transformSchema.params['pivotPoint'];
    if (pivotPoint.kind !== 'point') expect.fail('pivotPoint is not a point param');
    expect(Object.isFrozen(pivotPoint.default)).toBe(true);
    const pivot = transformSchema.params['pivot'];
    if (pivot.kind !== 'enum') expect.fail('pivot is not an enum param');
    expect(Object.isFrozen(pivot.options)).toBe(true);
    for (const option of pivot.options) expect(Object.isFrozen(option)).toBe(true);
  });

  it('defaults move nothing: no body, pivot at the bodies center, no translation, no rotation', () => {
    expect(transformSchema.defaults()).toEqual({
      bodies: [],
      pivot: 'bodiesCenter',
      pivotPoint: [0, 0, 0],
      translate: [0, 0, 0],
      rx: 0,
      ry: 0,
      rz: 0,
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

  it.each(ANGLES)('accepts any finite %s, negative and above a full turn', (key) => {
    for (const angle of [-10, 7, -Math.PI, 4 * Math.PI]) {
      const params = aTransform('t1', { [key]: angle }).params;
      expect(transformSchema.validate(params), String(angle)).toEqual([]);
    }
  });

  it.each(ANGLES)('rejects a NaN or infinite %s', (key) => {
    for (const angle of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(transformSchema.validate(aTransform('t1', { [key]: angle }).params)).toEqual([
        { param: key, code: 'param.wrongType' },
      ]);
    }
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
    const withoutRy = Object.fromEntries(
      Object.entries(aTransform('t1').params).filter(([key]) => key !== 'ry'),
    );
    expect(transformSchema.validate(withoutRy).map((i) => i.param)).toEqual(['ry']);
    const extra = { ...aTransform('t1').params, scale: 2 };
    expect(transformSchema.validate(extra).map((i) => i.param)).toEqual(['scale']);
    // The params of version 2 are gone.
    const old = { ...aTransform('t1').params, axis: 'z', angle: 0 };
    expect(transformSchema.validate(old).map((i) => i.param)).toEqual(['axis', 'angle']);
  });
});

describe('transformSchema.migrate', () => {
  const v1 = {
    bodies: [ref('b1/body')],
    translate: [1, 2, 3],
    axis: 'x',
    angle: 0.5,
  };
  const v2 = (axis: string, angle = 0.5) => ({
    bodies: [ref('b1/body')],
    pivot: 'point',
    pivotPoint: [4, 5, 6],
    translate: [1, 2, 3],
    axis,
    angle,
  });

  it.each([
    ['x', { rx: 0.5, ry: 0, rz: 0 }],
    ['y', { rx: 0, ry: 0.5, rz: 0 }],
    ['z', { rx: 0, ry: 0, rz: 0.5 }],
  ] as const)('version 2 with the axis %s moves the angle to its angle', (axis, angles) => {
    const migrated = transformSchema.migrate?.(2, v2(axis));

    expect(migrated).toEqual({
      bodies: [ref('b1/body')],
      pivot: 'point',
      pivotPoint: [4, 5, 6],
      translate: [1, 2, 3],
      ...angles,
    });
    expect(migrated).not.toHaveProperty('axis');
    expect(migrated).not.toHaveProperty('angle');
    expect(transformSchema.validate(migrated)).toEqual([]);
  });

  it('version 1 goes through version 2: the pivot origin and rx from the angle about x', () => {
    const migrated = transformSchema.migrate?.(1, v1);

    expect(migrated).toEqual({
      bodies: [ref('b1/body')],
      translate: [1, 2, 3],
      pivot: 'origin',
      pivotPoint: [0, 0, 0],
      rx: 0.5,
      ry: 0,
      rz: 0,
    });
    expect(transformSchema.validate(migrated)).toEqual([]);
  });

  it('throws for an unknown version', () => {
    for (const version of [0, 3, 4]) {
      expect(() => transformSchema.migrate?.(version, v1), String(version)).toThrow(
        /transform.*version/,
      );
    }
  });

  it.each([1, 2])('throws for data of version %i that are not an object', (version) => {
    for (const raw of [null, 42, 'params', [1, 2]]) {
      expect(() => transformSchema.migrate?.(version, raw), JSON.stringify(raw)).toThrow();
    }
  });

  it('passes data of version 2 with an unknown or missing axis unchanged', () => {
    expect(transformSchema.migrate?.(2, v2('w'))).toEqual(v2('w'));
    const withoutAxis = Object.fromEntries(
      Object.entries(v2('x')).filter(([key]) => key !== 'axis'),
    );
    expect(transformSchema.migrate?.(2, withoutAxis)).toEqual(withoutAxis);
    expect(transformSchema.migrate?.(1, { ...v1, axis: undefined })).toEqual({
      ...v1,
      axis: undefined,
      pivot: 'origin',
      pivotPoint: [0, 0, 0],
    });
  });

  it('fromData loads a feature of version 2 with an unknown axis, validate reports it', () => {
    const schemas = createFeatureSchemaRegistry();
    schemas.register(transformSchema);
    const feature = { ...aTransform('t1'), typeVersion: 2, params: v2('w') };

    const loaded = fromData(
      {
        meta: { id: 'doc1', name: 'Old', createdAt: 0 },
        studio: { features: [feature], rollbackIndex: 1 },
      },
      schemas,
    );

    if (!loaded.ok) expect.fail(JSON.stringify(loaded.error));
    const [migrated] = loaded.value.studio.features;
    expect(migrated).toMatchObject({ id: 't1', typeVersion: 3, params: v2('w') });
    const problems = transformSchema.validate(migrated?.params).map((i) => i.param);
    expect([...problems].sort()).toEqual(['angle', 'axis', 'rx', 'ry', 'rz']);
  });

  it.each([
    [1, v1, { pivot: 'origin', pivotPoint: [0, 0, 0], rx: 0.5, ry: 0, rz: 0 }],
    [2, v2('y'), { pivot: 'point', pivotPoint: [4, 5, 6], rx: 0, ry: 0.5, rz: 0 }],
  ] as const)('fromData loads a feature of version %i as version 3', (version, raw, expected) => {
    const schemas = createFeatureSchemaRegistry();
    schemas.register(transformSchema);
    const feature = { ...aTransform('t1'), typeVersion: version, params: raw };

    const loaded = fromData(
      {
        meta: { id: 'doc1', name: 'Old', createdAt: 0 },
        studio: { features: [feature], rollbackIndex: 1 },
      },
      schemas,
    );

    if (!loaded.ok) expect.fail(JSON.stringify(loaded.error));
    expect(loaded.value.studio.features).toMatchObject([
      {
        id: 't1',
        typeVersion: 3,
        params: { bodies: [ref('b1/body')], translate: [1, 2, 3], ...expected },
      },
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
  const modeKeys = (): readonly string[] => (transformManipulators.modes ?? []).map((m) => m.label);

  it.each(['cs', 'en'] as const)(
    '%s has a text for every key of the schema and the modes',
    (lang) => {
      for (const key of [...schemaKeys(), ...modeKeys()]) {
        expect(transformMessages[lang][key], `${lang}: ${key}`).toEqual(expect.any(String));
        expect(transformMessages[lang][key], `${lang}: ${key}`).not.toBe('');
      }
    },
  );

  it('cs and en have the same keys, the texts of version 2 are gone', () => {
    expect(Object.keys(transformMessages.cs).sort()).toEqual(
      Object.keys(transformMessages.en).sort(),
    );
    for (const key of Object.keys(transformMessages.cs)) {
      expect(key).not.toMatch(/^transform\.(axis|angle)/);
    }
  });

  it('has the texts of the plan', () => {
    const texts = (lang: 'cs' | 'en') =>
      [...schemaKeys(), ...modeKeys()].map((key) => transformMessages[lang][key]);
    expect(texts('cs')).toEqual([
      'Transformace',
      'Tělesa',
      'Střed otáčení',
      'Střed těles',
      'Počátek',
      'Bod',
      'Bod otáčení',
      'Posun',
      'Otočení X',
      'Otočení Y',
      'Otočení Z',
      'Volný',
      'Posun',
      'Otočení',
      'Nastavit pivot',
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
      'Rotation X',
      'Rotation Y',
      'Rotation Z',
      'Free',
      'Move',
      'Rotate',
      'Set pivot',
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

    const next = await build(aTransform('t1', { pivot: 'origin', rz: Math.PI / 2 }), state, kernel);

    expectBox(await bboxOf(kernel, next, 'b1/body'), { min: [-4, 0, 0], max: [0, 2, 6] });
  });

  it.each([
    ['rx', { min: [0, -6, 0], max: [2, 0, 4] }],
    ['ry', { min: [0, 0, -2], max: [6, 4, 0] }],
  ] as const)('rotates by 90 degrees with %s', async (key, expected) => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);

    const next = await build(
      aTransform('t1', { pivot: 'origin', [key]: Math.PI / 2 }),
      state,
      kernel,
    );

    expectBox(await bboxOf(kernel, next, 'b1/body'), {
      min: [...expected.min],
      max: [...expected.max],
    });
  });

  it.each([
    [
      { rx: Math.PI / 2, rz: Math.PI / 2 },
      { min: [0, 0, 0], max: [6, 2, 4] },
    ],
    [
      { rx: Math.PI / 2, ry: Math.PI / 2, rz: Math.PI / 2 },
      { min: [0, 0, -2], max: [6, 4, 0] },
    ],
  ] as const)('rotates by Rz · Ry · Rx (x first, z last): %j', async (angles, expected) => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);

    const next = await build(aTransform('t1', { pivot: 'origin', ...angles }), state, kernel);

    // [0, 2] x [0, 4] x [0, 6]: Rx(90°) gives x in [0, 2], y in [-6, 0], z in [0, 4]; Ry(90°)
    // then x in [0, 4], y in [-6, 0], z in [-2, 0]; Rz(90°) last. Rx · Rz would give
    // [-4, -6, 0]–[0, 0, 2] for the first case.
    expectBox(await bboxOf(kernel, next, 'b1/body'), {
      min: [...expected.min],
      max: [...expected.max],
    });
  });

  it('rotates first, then translates (T · R, not R · T)', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);

    const next = await build(
      aTransform('t1', { pivot: 'origin', translate: [10, 0, 0], rz: Math.PI / 2 }),
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
      aBuildInput(aTransform('t1', { pivot: 'bodiesCenter', rz: Math.PI / 2 }), state),
      aBuildContext(kernel, state),
    );

    if (!output.ok) expect.fail(output.error.message);
    expectBox(await bboxOf(kernel, output.state, 'b1/body'), { min: [10, 0, 0], max: [12, 2, 2] });
    expectVec(output.anchors.pivot?.point, [11, 1, 1]);
  });

  it('point rotates about pivotPoint', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);

    const output = await transformBuilder.build(
      aBuildInput(
        aTransform('t1', {
          pivot: 'point',
          pivotPoint: [0, 4, 0],
          rz: Math.PI / 2,
        }),
        state,
      ),
      aBuildContext(kernel, state),
    );

    if (!output.ok) expect.fail(output.error.message);
    // [0, 2] x [0, 4] about (0, 4): x in [0, 4], y in [4, 6].
    expectBox(await bboxOf(kernel, output.state, 'b1/body'), { min: [0, 4, 0], max: [4, 6, 6] });
    // pivotPoint is in the params, so there is no pivot anchor (spec 07, the anchor is minimal),
    // but the anchors are there (empty): without them the controller shows no handles.
    expect(output.anchors).toEqual({});
  });

  it('pivot, then translation: T(translate) · T(p) · R · T(-p)', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [{ id: 'b1', origin: [10, 0, 0], size: [2, 4, 2] }]);

    const next = await build(
      aTransform('t1', { translate: [0, 0, 5], rz: Math.PI / 2 }),
      state,
      kernel,
    );

    // Center (11, 2, 1); rotated in place x in [9, 13], y in [1, 3], then up by 5.
    expectBox(await bboxOf(kernel, next, 'b1/body'), { min: [9, 1, 5], max: [13, 3, 7] });
  });

  it('gives the pivot anchor only for bodiesCenter, empty anchors for origin or point', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);

    for (const pivot of ['origin', 'point'] as const) {
      const output = await transformBuilder.build(
        aBuildInput(aTransform('t1', { pivot, pivotPoint: [7, 7, 7] }), state),
        aBuildContext(kernel, state),
      );
      if (!output.ok) expect.fail(output.error.message);
      expect(output.anchors, pivot).toEqual({});
    }
    const center = await transformBuilder.build(
      aBuildInput(aTransform('t1', { pivot: 'bodiesCenter' }), state),
      aBuildContext(kernel, state),
    );
    if (!center.ok) expect.fail(center.error.message);
    expect(Object.keys(center.anchors)).toEqual(['pivot']);
  });

  it('the anchor pivot of two bodies is the center of their joined bounding box', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX, { id: 'b2', origin: [20, -2, 0], size: [2, 2, 10] }]);

    const output = await transformBuilder.build(
      aBuildInput(aTransform('t1', { bodies: [ref('b1/body'), ref('b2/body')] }), state),
      aBuildContext(kernel, state),
    );

    if (!output.ok) expect.fail(output.error.message);
    // Joined box [0, -2, 0]–[22, 4, 10].
    expect(Object.keys(output.anchors)).toEqual(['pivot']);
    expectVec(output.anchors.pivot?.point, [11, 1, 5]);
  });

  it('the anchor does not depend on translate or the angles (spec 07, anchor invariant)', async () => {
    const kernel = createFakeKernel();
    const state = await aState(kernel, [BOX]);
    const anchorsOf = async (params: Partial<TransformParams>) => {
      const feature = aTransform('t1', { pivot: 'bodiesCenter', ...params });
      const output = await transformBuilder.build(
        aBuildInput(feature, state),
        aBuildContext(kernel, state),
      );
      if (!output.ok) expect.fail(output.error.message);
      return output.anchors;
    };

    const a = await anchorsOf({ translate: [0, 0, 0], rx: 0, ry: 0, rz: 0 });
    const b = await anchorsOf({ translate: [5, -3, 9], rx: 1.2, ry: -0.4, rz: 2.5 });

    expect(b).toEqual(a);
    expectVec(a.pivot?.point, [1, 2, 3]);
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

    const output = await transformBuilder.build(
      aBuildInput(feature, state),
      aBuildContext(kernel, state),
    );

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
      transformBuilder.build(aBuildInput(aTransform('t1'), state), aBuildContext(kernel, state)),
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
      aBuildInput(aTransform('t1'), EMPTY_STATE),
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

  /** Parses raw log entries as stored by an older version and replays them into a new document. */
  function replayRaw(
    schemas: ReturnType<typeof aSetup>['schemas'],
    ops: readonly Readonly<Record<string, unknown>>[],
  ) {
    const handlers = createOpHandlerRegistry({ schemas });
    const entries: LogEntry[] = ops.map((op, i) => {
      const parsed = parseLogEntry(handlers, {
        op,
        seq: i + 1,
        kind: 'do',
        // The inverse is not replayed; any valid operation does.
        inverse: { type: 'feature.remove', v: 1, featureId: 't1' },
        label: 'old',
        time: 0,
      });
      if (!parsed.ok) expect.fail(JSON.stringify(parsed.error));
      return parsed.value;
    });
    const doc = createDocument({
      meta: { id: 'doc1' as DocumentId, name: 'Old', createdAt: 0 }, // a test id is trusted
    });
    replayLog(doc, handlers, entries);
    return doc;
  }

  const BOX_2 = aFeature({ id: 'b1', params: { size: 2 } });
  const T1 = { id: 't1', type: 'transform', name: 'T', suppressed: false };

  it('a log of version 1 replays to version 3 with the pivot origin and builds as before', async () => {
    const { kernel, schemas, regenerator } = aSetup();
    const v1 = { bodies: [ref('b1/body')], translate: [0, 0, 0], axis: 'z', angle: 0 };
    const rotated = { ...v1, angle: Math.PI / 2 };
    const moved = { ...rotated, translate: [10, 0, 0] };

    // Raw entries as stored before M18: feature.add with typeVersion 1 inside the feature,
    // feature.setParams of the current version with typeVersion 1 and one from before M10.1.
    const doc = replayRaw(schemas, [
      { type: 'feature.add', v: 1, feature: BOX_2, index: 0 },
      { type: 'feature.add', v: 1, feature: { ...T1, typeVersion: 1, params: v1 }, index: 1 },
      {
        type: 'feature.setParams',
        v: OP_VERSION['feature.setParams'],
        featureId: 't1',
        typeVersion: 1,
        params: rotated,
      },
      { type: 'feature.setParams', v: 1, featureId: 't1', params: moved },
    ]);

    const feature = doc.studio.features.find((f) => f.id === 't1');
    expect(feature).toEqual(
      expect.objectContaining({
        typeVersion: 3,
        params: {
          bodies: [ref('b1/body')],
          translate: [10, 0, 0],
          pivot: 'origin',
          pivotPoint: [0, 0, 0],
          rx: 0,
          ry: 0,
          rz: Math.PI / 2,
        },
      }),
    );
    const r = result(await regenerator.run({ features: doc.studio.features, rollbackIndex: 2 }));
    expect(r.statuses.get('t1' as FeatureId)).toEqual({ kind: 'ok' });
    // As in version 1: rotated about z through the origin to x in [-2, 0], then by 10 along x.
    expectBox(await bboxOf(kernel, r.finalState, 'b1/body'), { min: [8, 0, 0], max: [10, 2, 2] });
  });

  it('a log of version 2 replays to version 3 and builds as before', async () => {
    const { kernel, schemas, regenerator } = aSetup();
    const v2 = {
      bodies: [ref('b1/body')],
      pivot: 'bodiesCenter',
      pivotPoint: [0, 0, 0],
      translate: [0, 0, 0],
      axis: 'z',
      angle: 0,
    };
    const rotated = { ...v2, axis: 'y', angle: Math.PI / 2, translate: [0, 0, 5] };

    // Raw entries as stored in M18: a feature of version 2 and setParams with typeVersion 2.
    const doc = replayRaw(schemas, [
      { type: 'feature.add', v: 1, feature: BOX_2, index: 0 },
      { type: 'feature.add', v: 1, feature: { ...T1, typeVersion: 2, params: v2 }, index: 1 },
      {
        type: 'feature.setParams',
        v: OP_VERSION['feature.setParams'],
        featureId: 't1',
        typeVersion: 2,
        params: rotated,
      },
    ]);

    const feature = doc.studio.features.find((f) => f.id === 't1');
    expect(feature).toEqual(
      expect.objectContaining({
        typeVersion: 3,
        params: {
          bodies: [ref('b1/body')],
          pivot: 'bodiesCenter',
          pivotPoint: [0, 0, 0],
          translate: [0, 0, 5],
          rx: 0,
          ry: Math.PI / 2,
          rz: 0,
        },
      }),
    );
    const r = result(await regenerator.run({ features: doc.studio.features, rollbackIndex: 2 }));
    expect(r.statuses.get('t1' as FeatureId)).toEqual({ kind: 'ok' });
    // The cube [0, 2]^3 turns about its own center (1, 1, 1) onto itself, then goes up by 5.
    expectBox(await bboxOf(kernel, r.finalState, 'b1/body'), { min: [0, 0, 5], max: [2, 2, 7] });
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
    ...overrides,
  });
  const DEG = Math.PI / 180;

  function frameOf(p: TransformParams, anchors: FeatureAnchors, mode = 'free'): ManipulatorFrame {
    const frame = transformManipulators.frame(anEvaluated(p), anchors, mode);
    if (frame === null) expect.fail('no frame');
    return frame;
  }
  function handlesOf(
    p: TransformParams,
    anchors: FeatureAnchors,
    mode = 'free',
  ): readonly Handle[] {
    return frameOf(p, anchors, mode).handles;
  }

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
  function planar(handles: readonly Handle[], id: string): PlanarHandle {
    const h = handle(handles, id);
    if (h.kind !== 'planar') expect.fail(`${id} is not planar`);
    return h;
  }
  function point(handles: readonly Handle[], id: string): PointHandle {
    const h = handle(handles, id);
    if (h.kind !== 'point') expect.fail(`${id} is not a point`);
    return h;
  }

  /** R = Rz · Ry · Rx applied to a vector, computed here on its own from the world axes. */
  function rotate(p: Pick<TransformParams, 'rx' | 'ry' | 'rz'>, v: Vec3): Vec3 {
    const r = mat4.multiply(
      mat4.rotationAxisAngle([0, 0, 1], p.rz),
      mat4.multiply(
        mat4.rotationAxisAngle([0, 1, 0], p.ry),
        mat4.rotationAxisAngle([1, 0, 0], p.rx),
      ),
    );
    // A pure rotation: transforming the vector as a point is R · v.
    return mat4.transformPoint(r, v);
  }

  describe('modes', () => {
    it('are free, move, rotate and pivot in this order; only pivot picks a point', () => {
      expect(transformManipulators.modes).toEqual([
        { id: 'free', label: 'transform.mode.free', icon: 'arrows-move' },
        { id: 'move', label: 'transform.mode.move', icon: 'arrows-up-down' },
        { id: 'rotate', label: 'transform.mode.rotate', icon: 'rotate-clockwise' },
        { id: 'pivot', label: 'transform.mode.pivot', icon: 'focus-2', picksPoint: true },
      ]);
    });

    it('are frozen', () => {
      const modes = transformManipulators.modes ?? expect.fail('no modes');
      expect(Object.isFrozen(modes)).toBe(true);
      for (const mode of modes) expect(Object.isFrozen(mode), mode.id).toBe(true);
    });

    it.each([
      ['free', ['tx', 'ty', 'tz', 'txy', 'tyz', 'tzx', 'tc', 'rx', 'ry', 'rz']],
      ['move', ['tx', 'ty', 'tz', 'txy', 'tyz', 'tzx', 'tc']],
      ['rotate', ['rx', 'ry', 'rz']],
      ['pivot', ['px', 'py', 'pz', 'pxy', 'pyz', 'pzx', 'pc']],
    ] as const)('%s has the handles %j', (mode, ids) => {
      expect(handlesOf(params(), ANCHORS, mode).map((h) => h.id)).toEqual(ids);
    });

    it('the handles of the pivot mode have ids of their own', () => {
      const pivot = handlesOf(params(), ANCHORS, 'pivot').map((h) => h.id);
      const free = handlesOf(params(), ANCHORS, 'free').map((h) => h.id);
      expect(pivot.filter((id) => free.includes(id))).toEqual([]);
    });

    it('rings are quarter circles in free and full circles in rotate', () => {
      for (const id of ['rx', 'ry', 'rz']) {
        expect(angular(handlesOf(params(), ANCHORS, 'free'), id).extent, id).toBe('quarter');
        expect(angular(handlesOf(params(), ANCHORS, 'rotate'), id).extent, id).toBe('full');
      }
    });

    it('only the handles of the pivot mode are dashed', () => {
      for (const mode of ['free', 'move', 'rotate', 'pivot']) {
        for (const h of handlesOf(params(), ANCHORS, mode)) {
          expect(h.dashed === true, `${mode}: ${h.id}`).toBe(mode === 'pivot');
        }
      }
    });

    it('an unknown mode gives no frame', () => {
      expect(transformManipulators.frame(anEvaluated(params()), ANCHORS, '')).toBeNull();
      expect(transformManipulators.frame(anEvaluated(params()), ANCHORS, 'scale')).toBeNull();
    });
  });

  describe('frame', () => {
    it('bodiesCenter gives no frame without the anchor pivot', () => {
      for (const mode of ['free', 'move', 'rotate', 'pivot']) {
        expect(transformManipulators.frame(anEvaluated(params()), {}, mode), mode).toBeNull();
      }
    });

    it('the center of the frame is pivot + translate in every mode', () => {
      for (const mode of ['free', 'move', 'rotate', 'pivot']) {
        expect(frameOf(params(), ANCHORS, mode).center, mode).toEqual([11, 22, 33]);
      }
    });

    it('origin: the handles stand at translate without any anchor', () => {
      const handles = handlesOf(params({ pivot: 'origin' }), {});
      expect(linear(handles, 'tx').position).toEqual([10, 20, 30]);
      expect(angular(handles, 'rz').center).toEqual([10, 20, 30]);
    });

    it('point: the handles stand at pivotPoint + translate without any anchor', () => {
      const handles = handlesOf(params({ pivot: 'point', pivotPoint: [-1, 0, 2] }), {});
      expect(linear(handles, 'tz').position).toEqual([9, 20, 32]);
      expect(angular(handles, 'rx').center).toEqual([9, 20, 32]);
    });

    it('origin and point ignore a stale anchor pivot', () => {
      const origin = handlesOf(params({ pivot: 'origin' }), ANCHORS);
      expect(linear(origin, 'tx').position).toEqual([10, 20, 30]);
      const pt = handlesOf(params({ pivot: 'point', pivotPoint: [-1, 0, 2] }), ANCHORS);
      expect(linear(pt, 'tx').position).toEqual([9, 20, 32]);
    });

    it('the frame, the handles and their vectors are frozen', () => {
      for (const mode of ['free', 'move', 'rotate', 'pivot']) {
        const frame = frameOf(params({ rz: 0.3 }), ANCHORS, mode);
        expect(Object.isFrozen(frame), mode).toBe(true);
        expect(Object.isFrozen(frame.center), mode).toBe(true);
        expect(Object.isFrozen(frame.handles), mode).toBe(true);
        for (const h of frame.handles) {
          expect(Object.isFrozen(h), h.id).toBe(true);
          const vectors = Object.values(h).filter((v) => Array.isArray(v));
          for (const v of vectors) expect(Object.isFrozen(v), h.id).toBe(true);
        }
      }
    });
  });

  describe('translation (free, move)', () => {
    it('arrows stand at c along the world axes with the translate values, even when rotated', () => {
      const handles = handlesOf(params({ rx: 0.4, rz: 1.1 }), ANCHORS, 'move');
      const expected: readonly [string, Vec3, number, string][] = [
        ['tx', [1, 0, 0], 10, 'x'],
        ['ty', [0, 1, 0], 20, 'y'],
        ['tz', [0, 0, 1], 30, 'z'],
      ];
      for (const [id, direction, value, tint] of expected) {
        const h = linear(handles, id);
        expect(h.position, id).toEqual([11, 22, 33]);
        expect(h.direction, id).toEqual(direction);
        expect(h.value, id).toBe(value);
        expect([h.unit, h.tint], id).toEqual(['length', tint]);
      }
    });

    it('toParams of ty changes only the y of translate', () => {
      const ty = linear(handlesOf(params(), ANCHORS), 'ty');
      expect(ty.toParams(-4)).toEqual({ translate: [10, -4, 30] });
    });

    it('squares stand at c between two world axes, tinted by the normal', () => {
      const handles = handlesOf(params({ ry: 0.8 }), ANCHORS, 'move');
      const expected: readonly [string, Vec3, Vec3, string, readonly [number, number]][] = [
        ['txy', [1, 0, 0], [0, 1, 0], 'z', [10, 20]],
        ['tyz', [0, 1, 0], [0, 0, 1], 'x', [20, 30]],
        ['tzx', [0, 0, 1], [1, 0, 0], 'y', [30, 10]],
      ];
      for (const [id, u, v, tint, value] of expected) {
        const h = planar(handles, id);
        expect(h.origin, id).toEqual([11, 22, 33]);
        expect([h.u, h.v], id).toEqual([u, v]);
        expect([h.unit, h.tint], id).toEqual(['length', tint]);
        expect(h.value, id).toEqual(value);
      }
    });

    it('toParams of a square changes its two components of translate', () => {
      const handles = handlesOf(params(), ANCHORS, 'move');
      expect(planar(handles, 'txy').toParams([1, 2])).toEqual({ translate: [1, 2, 30] });
      expect(planar(handles, 'tyz').toParams([1, 2])).toEqual({ translate: [10, 1, 2] });
      expect(planar(handles, 'tzx').toParams([1, 2])).toEqual({ translate: [2, 20, 1] });
    });

    it('the center point stands at c, is neutral and writes the whole translate', () => {
      const tc = point(handlesOf(params(), ANCHORS, 'free'), 'tc');
      expect(tc.position).toEqual([11, 22, 33]);
      expect([tc.unit, tc.tint]).toEqual(['length', 'neutral']);
      expect(tc.value).toEqual([10, 20, 30]);
      expect(tc.toParams([-1, 5, 7])).toEqual({ translate: [-1, 5, 7] });
    });
  });

  describe('rotation (free, rotate)', () => {
    it('without rotation the rings lie about Z, Y, X with zero X, Z, Y', () => {
      const handles = handlesOf(params(), ANCHORS, 'rotate');
      const expected: readonly [string, Vec3, Vec3, string][] = [
        ['rx', [1, 0, 0], [0, 1, 0], 'x'],
        ['ry', [0, 1, 0], [0, 0, 1], 'y'],
        ['rz', [0, 0, 1], [1, 0, 0], 'z'],
      ];
      for (const [id, axis, zero, tint] of expected) {
        const h = angular(handles, id);
        expect(h.center, id).toEqual([11, 22, 33]);
        expectVec(h.axis, axis);
        expectVec(h.zero, zero);
        expect([h.unit, h.tint], id).toEqual(['angle', tint]);
      }
    });

    it('every ring has its own angle and writes only it', () => {
      const handles = handlesOf(params({ rx: 0.1, ry: 0.2, rz: 0.3 }), ANCHORS, 'free');
      expect(angular(handles, 'rx').value).toBe(0.1);
      expect(angular(handles, 'ry').value).toBe(0.2);
      expect(angular(handles, 'rz').value).toBe(0.3);
      expect(angular(handles, 'rx').toParams(1)).toEqual({ rx: 1 });
      expect(angular(handles, 'ry').toParams(2)).toEqual({ ry: 2 });
      expect(angular(handles, 'rz').toParams(3)).toEqual({ rz: 3 });
    });

    it('gimbal: after rz = 90° the ring ry lies about -X and rx about Y', () => {
      const handles = handlesOf(params({ rz: 90 * DEG }), ANCHORS, 'rotate');
      expectVec(angular(handles, 'rz').axis, [0, 0, 1]);
      expectVec(angular(handles, 'rz').zero, [1, 0, 0]);
      expectVec(angular(handles, 'ry').axis, [-1, 0, 0]);
      expectVec(angular(handles, 'ry').zero, [0, 0, 1]);
      expectVec(angular(handles, 'rx').axis, [0, 1, 0]);
      expectVec(angular(handles, 'rx').zero, [-1, 0, 0]);
    });

    it('gimbal: after ry = 90° and rz = 90° the ring rx lies about -Z', () => {
      const handles = handlesOf(params({ ry: 90 * DEG, rz: 90 * DEG }), ANCHORS, 'rotate');
      expectVec(angular(handles, 'rx').axis, [0, 0, -1]);
      expectVec(angular(handles, 'rx').zero, [-1, 0, 0]);
    });

    it('turning a ring by d turns the result about the axis of the ring by d', () => {
      const angles = { rx: 30 * DEG, ry: -50 * DEG, rz: 110 * DEG };
      const handles = handlesOf(params(angles), ANCHORS, 'rotate');
      const d = 0.4;
      const probe: Vec3 = [0.3, -1.2, 2.5];
      for (const key of ['rx', 'ry', 'rz'] as const) {
        const ring = angular(handles, key);
        const turned = rotate({ ...angles, [key]: angles[key] + d }, probe);
        const aboutRing = mat4.transformPoint(
          mat4.rotationAxisAngle(ring.axis, d),
          rotate(angles, probe),
        );
        expectVec(turned, aboutRing);
        // zero lies on the ring: perpendicular to its axis.
        expect(vec3.dot(ring.zero, ring.axis), key).toBeCloseTo(0, 12);
      }
    });
  });

  describe('pivot', () => {
    it('handles stand at c along the world axes with the components of c as values', () => {
      const handles = handlesOf(params({ rz: 0.5 }), ANCHORS, 'pivot');
      const expected: readonly [string, Vec3, number, string][] = [
        ['px', [1, 0, 0], 11, 'x'],
        ['py', [0, 1, 0], 22, 'y'],
        ['pz', [0, 0, 1], 33, 'z'],
      ];
      for (const [id, direction, value, tint] of expected) {
        const h = linear(handles, id);
        expect(h.position, id).toEqual([11, 22, 33]);
        expect(h.direction, id).toEqual(direction);
        expect(h.value, id).toBe(value);
        expect([h.unit, h.tint], id).toEqual(['length', tint]);
      }
      expect(planar(handles, 'pxy').value).toEqual([11, 22]);
      expect(planar(handles, 'pyz').value).toEqual([22, 33]);
      expect(planar(handles, 'pzx').value).toEqual([33, 11]);
      expect(planar(handles, 'pyz').tint).toBe('x');
      expect(point(handles, 'pc').value).toEqual([11, 22, 33]);
      expect(point(handles, 'pc').tint).toBe('neutral');
    });

    it('without rotation moving c moves the pivot point, translate stays', () => {
      const px = linear(handlesOf(params(), ANCHORS, 'pivot'), 'px');
      const patch = px.toParams(16);
      expect(patch).toEqual({ pivot: 'point', pivotPoint: [6, 2, 3], translate: [10, 20, 30] });
    });

    it('toParams of the pivot always writes pivot, pivotPoint and translate (Esc restores all)', () => {
      const handles = handlesOf(params({ rz: 0.5 }), ANCHORS, 'pivot');
      for (const h of handles) {
        const patch =
          h.kind === 'point'
            ? h.toParams(h.value)
            : h.kind === 'planar'
              ? h.toParams(h.value)
              : h.kind === 'linear'
                ? h.toParams(h.value)
                : expect.fail(`${h.id} is angular`);
        expect(Object.keys(patch).sort(), h.id).toEqual(['pivot', 'pivotPoint', 'translate']);
      }
    });

    it("lens: with rx = 30° and rz = 45° moving px by 5 mm keeps the body, the handles go to c'", async () => {
      const kernel = createFakeKernel();
      const state = await aState(kernel, [{ id: 'b1', origin: [3, -1, 2], size: [2, 4, 6] }]);
      const buildWith = async (p: TransformParams) => {
        const feature = aTransform('t1', p);
        const output = await transformBuilder.build(
          aBuildInput(feature, state),
          aBuildContext(kernel, state),
        );
        if (!output.ok) expect.fail(output.error.message);
        return {
          box: await bboxOf(kernel, output.state, 'b1/body'),
          anchors: output.anchors,
        };
      };
      const before = params({ translate: [7, -2, 4], rx: 30 * DEG, rz: 45 * DEG });
      const first = await buildWith(before);
      const c = frameOf(before, first.anchors, 'pivot').center;

      const px = linear(handlesOf(before, first.anchors, 'pivot'), 'px');
      const after: TransformParams = { ...before, ...px.toParams(px.value + 5) };
      const second = await buildWith(after);

      expectBox(second.box, first.box);
      expect(after.pivot).toBe('point');
      const moved = handlesOf(after, second.anchors, 'pivot');
      expectVec(linear(moved, 'px').position, [c[0] + 5, c[1], c[2]]);
      expect(linear(moved, 'px').value).toBeCloseTo(c[0] + 5, 9);
      expectVec(frameOf(after, second.anchors, 'free').center, [c[0] + 5, c[1], c[2]]);
    });

    it('lens: the square and the center point keep the body as well', async () => {
      const kernel = createFakeKernel();
      const state = await aState(kernel, [{ id: 'b1', origin: [0, 0, 0], size: [2, 4, 6] }]);
      const boxOf = async (p: TransformParams) => {
        const feature = aTransform('t1', p);
        const output = await transformBuilder.build(
          aBuildInput(feature, state),
          aBuildContext(kernel, state),
        );
        if (!output.ok) expect.fail(output.error.message);
        return bboxOf(kernel, output.state, 'b1/body');
      };
      const before = params({
        pivot: 'point',
        pivotPoint: [1, 1, 1],
        translate: [2, 3, 4],
        rx: 20 * DEG,
        ry: -35 * DEG,
        rz: 70 * DEG,
      });
      const box = await boxOf(before);
      const handles = handlesOf(before, {}, 'pivot');

      const square = planar(handles, 'pyz');
      const viaSquare = {
        ...before,
        ...square.toParams([square.value[0] - 3, square.value[1] + 2]),
      };
      expectBox(await boxOf(viaSquare), box);
      expectVec(frameOf(viaSquare, {}, 'pivot').center, [3, 4 - 3, 5 + 2]);

      const viaPoint = { ...before, ...point(handles, 'pc').toParams([-5, 6, 0.5]) };
      expectBox(await boxOf(viaPoint), box);
      expectVec(frameOf(viaPoint, {}, 'pivot').center, [-5, 6, 0.5]);
    });
  });

  describe('pickPoint', () => {
    it('in the pivot mode puts the pivot at the point and keeps the body', async () => {
      const kernel = createFakeKernel();
      const state = await aState(kernel, [{ id: 'b1', origin: [0, 0, 0], size: [2, 4, 6] }]);
      const output = async (p: TransformParams) => {
        const feature = aTransform('t1', p);
        const out = await transformBuilder.build(
          aBuildInput(feature, state),
          aBuildContext(kernel, state),
        );
        if (!out.ok) expect.fail(out.error.message);
        return { box: await bboxOf(kernel, out.state, 'b1/body'), anchors: out.anchors };
      };
      const before = params({ translate: [1, 2, 3], rx: 30 * DEG, rz: 45 * DEG });
      const first = await output(before);

      const patch = transformManipulators.pickPoint?.(
        anEvaluated(before),
        first.anchors,
        'pivot',
        [4, 5, 6],
      );
      if (patch === undefined || patch === null) expect.fail('no patch');
      const after: TransformParams = { ...before, ...patch };
      const second = await output(after);

      expect(Object.keys(patch).sort()).toEqual(['pivot', 'pivotPoint', 'translate']);
      expectBox(second.box, first.box);
      expectVec(frameOf(after, second.anchors, 'pivot').center, [4, 5, 6]);
    });

    it('gives null outside the pivot mode', () => {
      for (const mode of ['free', 'move', 'rotate', '']) {
        expect(
          transformManipulators.pickPoint?.(anEvaluated(params()), ANCHORS, mode, [4, 5, 6]),
          mode,
        ).toBeNull();
      }
    });

    it('gives null for bodiesCenter without the anchor pivot', () => {
      expect(
        transformManipulators.pickPoint?.(anEvaluated(params()), {}, 'pivot', [4, 5, 6]),
      ).toBeNull();
    });
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
  const viewport = new FakeViewport();
  const manager = createToolManager({
    registry,
    ctx: {
      viewport,
      selection: createSelectionModel({ regen: new FakeRegenStatus() }),
      doc: ops.doc,
      ids: createSequentialIdGenerator('t'),
      features: editor,
    },
    viewportEvents: viewport.events,
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
