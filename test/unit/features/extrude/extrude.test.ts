import { describe, expect, it } from 'vitest';
import { ObservableValue, createSequentialIdGenerator, vec3 } from '@/core';
import type { Plane, Vec3 } from '@/core';
import { ORIGIN_PLANES, bodyId, createFeatureSchemaRegistry, isParamVisible } from '@/document';
import type {
  BodyId,
  BodyRef,
  FeatureId,
  FeatureInstance,
  ParamSchema,
  ParamSpec,
  SketchRegionRef,
  TopoName,
  TopoRef,
} from '@/document';
import { aFeature, anEvaluated } from '@/document/testing';
import {
  SELECT_TOOL,
  createSelectionModel,
  createToolManager,
  createManipulatorRegistry,
  createToolRegistry,
} from '@/interaction';
import type { FeatureEditor, FeatureEditSession, Handle, LinearHandle } from '@/interaction';
import { FakeRegenStatus, FakeViewport } from '@/interaction/testing';
import type { BooleanOp, FaceInfo, ShapeHandle } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import { anOpsSession } from '@/ops/testing';
import { registerPlugin } from '@/plugin-api';
import { EMPTY_NAMES, createBuilderRegistry } from '@/regen';
import type {
  Artifact,
  ArtifactId,
  Body,
  BuildOutput,
  ModelingKernel,
  NameTable,
  RegenState,
} from '@/regen';
import { aBuildContext, aBuildInput, aNameTable, aSketchArtifact } from '@/regen/testing';
import { extrudeBuilder } from '@/features/extrude/builder';
import { extrudeManipulators } from '@/features/extrude/manipulators';
import { extrudeMessages } from '@/features/extrude/messages';
import { extrudeSchema, flipApplies } from '@/features/extrude/schema';
import type { ExtrudeParams } from '@/features/extrude/schema';
import { extrudeTool } from '@/features/extrude/tool';
import * as extrude from '@/features/extrude';

// ---------------------------------------------------------------------------------------------
// Helpers

function region(name = 'r1', sketch = 's'): SketchRegionRef {
  return { kind: 'region', sketch: sketch as FeatureId, region: name };
}

function bodyRef(id: string): BodyRef {
  return { kind: 'body', body: bodyId(id as FeatureId) };
}

function topoRef(body: string, name: string): TopoRef {
  // Test data: hand-written ids and names stand for minted ones.
  return { kind: 'topo', body: body as BodyId, name: name as TopoName };
}

function anExtrude(
  id: string,
  params: Partial<ExtrudeParams> = {},
): FeatureInstance<ExtrudeParams> {
  return aFeature({
    id,
    type: 'extrude',
    params: { ...extrudeSchema.defaults(), regions: [region()], ...params },
  });
}

function originPlane(index: number): Plane {
  const p = ORIGIN_PLANES[index];
  if (p === undefined) expect.fail(`No origin plane ${String(index)}`);
  return p.plane;
}

const XY = 0;
const XZ = 1;

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
    fillet: (shape, edges, radius) => fake.fillet(shape, edges, radius),
    chamfer: (shape, edges, distance) => fake.chamfer(shape, edges, distance),
    boundingBox: (shape) => fake.boundingBox(shape),
    topology: (shape) => fake.topology(shape),
  };
  return { fake, kernel, calls };
}

/** A planar rectangle face [x0, x0 + w] × [y0, y0 + h] in plane coordinates. */
async function rectangle(
  kernel: ModelingKernel,
  plane: Plane,
  [x0, y0]: readonly [number, number],
  [w, h]: readonly [number, number],
): Promise<ShapeHandle> {
  const corners: [number, number][] = [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h],
  ];
  const outer = corners.map((from, i) => ({
    kind: 'line' as const,
    from,
    to: corners[(i + 1) % corners.length] ?? from,
  }));
  const { shape } = await kernel.makeFace({ plane, outer, holes: [] });
  return shape;
}

/** A box body created by the feature `feature`. */
async function boxBody(
  kernel: ModelingKernel,
  feature: string,
  origin: Vec3,
  size: Vec3,
  names: NameTable = EMPTY_NAMES,
): Promise<Body> {
  const { shape } = await kernel.makeBox({ origin, size });
  const owner = feature as FeatureId;
  return Object.freeze({
    kind: 'body',
    id: bodyId(owner),
    origin: owner,
    lastModifiedBy: owner,
    shape,
    names,
  });
}

function stateOf(...artifacts: readonly Artifact[]): RegenState {
  return Object.freeze({
    artifacts: new Map<ArtifactId, Artifact>(artifacts.map((a) => [a.id, a])),
  });
}

/** A state with the sketch 's' on XY with the region r1 = rectangle 40 × 20 at the origin. */
async function rectangleState(kernel: ModelingKernel, plane = originPlane(XY)) {
  const face = await rectangle(kernel, plane, [0, 0], [40, 20]);
  return stateOf(aSketchArtifact('s', [face], { plane }));
}

async function run(
  feature: FeatureInstance<ExtrudeParams>,
  state: RegenState,
  kernel: ModelingKernel,
): Promise<BuildOutput> {
  return extrudeBuilder.build(aBuildInput(feature, state), aBuildContext(kernel, state));
}

async function build(
  feature: FeatureInstance<ExtrudeParams>,
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

function expectVec(actual: Vec3 | undefined, expected: Vec3): void {
  if (actual === undefined) expect.fail('No vector');
  for (let i = 0; i < 3; i++) {
    expect(actual[i], `[${String(i)}]`).toBeCloseTo(expected[i] ?? Number.NaN, 9);
  }
}

function paramOf(key: string): ParamSpec {
  // Read without the plugin's keys, as the registry does.
  const params: ParamSchema = extrudeSchema.params;
  const spec = params[key];
  if (spec === undefined) expect.fail(`No param ${key}`);
  return spec;
}

// ---------------------------------------------------------------------------------------------

describe('extrude public API', () => {
  it('exports exactly extrudePlugin', () => {
    expect(Object.keys(extrude)).toEqual(['extrudePlugin']);
  });

  it('extrudePlugin joins the schema, the builder, the tool, the messages and the manipulators', () => {
    expect(extrude.extrudePlugin.schema).toBe(extrudeSchema);
    expect(extrude.extrudePlugin.builder).toBe(extrudeBuilder);
    expect(extrude.extrudePlugin.tools).toEqual([extrudeTool]);
    expect(extrude.extrudePlugin.messages).toBe(extrudeMessages);
    expect(extrude.extrudePlugin.manipulators).toBe(extrudeManipulators);
    expect(extrudeSchema.type).toBe('extrude');
    expect(extrudeBuilder.type).toBe('extrude');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(extrude.extrudePlugin)).toBe(true);
    expect(Object.isFrozen(extrude.extrudePlugin.tools)).toBe(true);
    expect(Object.isFrozen(extrudeBuilder)).toBe(true);
  });

  it('registers schema, builder and tool through registerPlugin', () => {
    const regs = {
      schemas: createFeatureSchemaRegistry(),
      builders: createBuilderRegistry(),
      tools: createToolRegistry(),
      manipulators: createManipulatorRegistry(),
    };
    registerPlugin(extrude.extrudePlugin, regs);
    expect(regs.schemas.get('extrude')).toBe(extrudeSchema);
    expect(regs.builders.get('extrude')).toBe(extrudeBuilder);
    expect(regs.tools.get('extrude')).toBe(extrudeTool);
    expect(regs.manipulators.get('extrude')).toBe(extrudeManipulators);
  });
});

describe('extrudeSchema', () => {
  it('is version 1 of type extrude with the Tabler icon arrow-big-up-lines', () => {
    expect(extrudeSchema).toMatchObject({
      type: 'extrude',
      version: 1,
      label: 'extrude.label',
      icon: 'arrow-big-up-lines',
    });
  });

  it('has the params in the order of the plan with key labels (ADR 0014)', () => {
    expect(Object.entries(extrudeSchema.params).map(([key, spec]) => [key, spec.label])).toEqual([
      ['regions', 'extrude.regions'],
      ['operation', 'extrude.operation'],
      ['targets', 'extrude.targets'],
      ['endType', 'extrude.endType'],
      ['distance', 'extrude.distance'],
      ['upTo', 'extrude.upTo'],
      ['flip', 'extrude.flip'],
    ]);
  });

  it('has the kinds, bounds and defaults of the plan', () => {
    expect(paramOf('regions')).toEqual({ kind: 'region', label: 'extrude.regions', min: 1 });
    expect(paramOf('operation')).toEqual({
      kind: 'enum',
      label: 'extrude.operation',
      default: 'new',
      options: [
        { value: 'new', label: 'extrude.operation.new' },
        { value: 'add', label: 'extrude.operation.add' },
        { value: 'remove', label: 'extrude.operation.remove' },
        { value: 'intersect', label: 'extrude.operation.intersect' },
      ],
    });
    expect(paramOf('targets')).toMatchObject({
      kind: 'bodies',
      label: 'extrude.targets',
      min: 1,
      group: 'extrude.group.merge',
    });
    expect(paramOf('endType')).toEqual({
      kind: 'enum',
      label: 'extrude.endType',
      default: 'blind',
      options: [
        { value: 'blind', label: 'extrude.endType.blind' },
        { value: 'symmetric', label: 'extrude.endType.symmetric' },
        { value: 'upToFace', label: 'extrude.endType.upToFace' },
      ],
    });
    expect(paramOf('distance')).toMatchObject({
      kind: 'length',
      label: 'extrude.distance',
      default: 10,
      min: 0,
      exclusiveMin: true,
    });
    expect(paramOf('upTo')).toMatchObject({
      kind: 'topo',
      label: 'extrude.upTo',
      entity: 'face',
      min: 1,
      max: 1,
    });
    expect(paramOf('flip')).toMatchObject({
      kind: 'boolean',
      label: 'extrude.flip',
      default: false,
    });
  });

  it('is frozen deeply, param specs and enum options included', () => {
    expect(Object.isFrozen(extrudeSchema)).toBe(true);
    expect(Object.isFrozen(extrudeSchema.params)).toBe(true);
    for (const [key, spec] of Object.entries(extrudeSchema.params)) {
      expect(Object.isFrozen(spec), key).toBe(true);
      if (spec.kind !== 'enum') continue;
      expect(Object.isFrozen(spec.options), key).toBe(true);
      for (const option of spec.options) expect(Object.isFrozen(option), key).toBe(true);
    }
  });

  it('defaults are a new body of distance 10 without regions, a new object every call', () => {
    const a = extrudeSchema.defaults();
    expect(a).toEqual({
      regions: [],
      operation: 'new',
      targets: [],
      endType: 'blind',
      distance: 10,
      upTo: [],
      flip: false,
    });
    const b = extrudeSchema.defaults();
    expect(a).not.toBe(b);
    expect(a.regions).not.toBe(b.regions);
    expect(a.targets).not.toBe(b.targets);
    expect(a.upTo).not.toBe(b.upTo);
  });

  it('defaults with a picked region pass validation, alone they ask for a region', () => {
    expect(extrudeSchema.validate({ ...extrudeSchema.defaults(), regions: [region()] })).toEqual(
      [],
    );
    expect(extrudeSchema.validate(extrudeSchema.defaults())).toEqual([
      { param: 'regions', code: 'param.tooFewRefs', params: { min: 1 } },
    ]);
  });

  it('a change of the model needs a target', () => {
    const valid = anExtrude('x').params;
    expect(extrudeSchema.validate({ ...valid, operation: 'add' })).toEqual([
      { param: 'targets', code: 'param.tooFewRefs', params: { min: 1 } },
    ]);
    expect(
      extrudeSchema.validate({ ...valid, operation: 'remove', targets: [bodyRef('a')] }),
    ).toEqual([]);
  });

  it('a hidden invalid targets passes validation for a new body', () => {
    expect(extrudeSchema.validate({ ...anExtrude('x').params, targets: 'garbage' })).toEqual([]);
    const withoutTargets = Object.fromEntries(
      Object.entries(anExtrude('x').params).filter(([key]) => key !== 'targets'),
    );
    expect(extrudeSchema.validate(withoutTargets)).toEqual([]);
  });

  it('a hidden flip is not checked for a symmetric extrude', () => {
    const valid = anExtrude('x').params;
    expect(extrudeSchema.validate({ ...valid, endType: 'symmetric', flip: 'yes' })).toEqual([]);
    expect(extrudeSchema.validate({ ...valid, flip: 'yes' })).toEqual([
      { param: 'flip', code: 'param.wrongType' },
    ]);
  });

  it('rejects a distance that is not positive and an unknown option', () => {
    const valid = anExtrude('x').params;
    expect(extrudeSchema.validate({ ...valid, distance: 0 })).toEqual([
      { param: 'distance', code: 'param.atOrBelowMin', params: { min: 0 } },
    ]);
    expect(extrudeSchema.validate({ ...valid, endType: 'throughAll' })).toEqual([
      { param: 'endType', code: 'param.unknownOption' },
    ]);
  });

  it('data of version 1 without upTo stay valid (the hidden upTo is not required)', () => {
    const old = Object.fromEntries(
      Object.entries(anExtrude('x').params).filter(([key]) => key !== 'upTo'),
    );
    expect(extrudeSchema.validate(old)).toEqual([]);
    expect(extrudeSchema.validate({ ...old, endType: 'symmetric' })).toEqual([]);
  });

  it('up to face needs exactly one face, the hidden distance and flip are not checked', () => {
    const valid = anExtrude('x').params;
    expect(extrudeSchema.validate({ ...valid, endType: 'upToFace' })).toEqual([
      { param: 'upTo', code: 'param.tooFewRefs', params: { min: 1 } },
    ]);
    const face = topoRef('b/body', 'b/face:bottom');
    expect(
      extrudeSchema.validate({
        ...valid,
        endType: 'upToFace',
        upTo: [face],
        distance: -1,
        flip: 'yes',
      }),
    ).toEqual([]);
    expect(
      extrudeSchema.validate({
        ...valid,
        endType: 'upToFace',
        upTo: [face, topoRef('b/body', 'b/face:top')],
      }),
    ).toEqual([{ param: 'upTo', code: 'param.tooManyRefs', params: { max: 1 } }]);
  });
});

describe('extrude param visibility', () => {
  const targets = (): ParamSpec => paramOf('targets');
  const flip = (): ParamSpec => paramOf('flip');

  it.each([
    ['new', false],
    ['add', true],
    ['remove', true],
    ['intersect', true],
  ])('targets for operation %s visible: %s', (operation, visible) => {
    expect(isParamVisible(targets(), { ...anExtrude('x').params, operation })).toBe(visible);
  });

  it.each([
    ['blind', true],
    ['symmetric', false],
    ['upToFace', false],
  ])('flip for endType %s visible: %s', (endType, visible) => {
    expect(isParamVisible(flip(), { ...anExtrude('x').params, endType })).toBe(visible);
  });

  it.each([
    ['blind', true],
    ['symmetric', true],
    ['upToFace', false],
  ])('distance for endType %s visible: %s', (endType, visible) => {
    expect(isParamVisible(paramOf('distance'), { ...anExtrude('x').params, endType })).toBe(
      visible,
    );
  });

  it.each([
    ['blind', false],
    ['symmetric', false],
    ['upToFace', true],
  ])('upTo for endType %s visible: %s', (endType, visible) => {
    expect(isParamVisible(paramOf('upTo'), { ...anExtrude('x').params, endType })).toBe(visible);
  });

  it.each([
    ['blind', true],
    ['symmetric', false],
    ['upToFace', false],
  ])(
    'flipApplies(%s) is %s, the rule of both the predicate and the builder',
    (endType, applies) => {
      expect(flipApplies(endType)).toBe(applies);
    },
  );

  it('other params are always visible', () => {
    for (const key of ['regions', 'operation', 'endType']) {
      expect(isParamVisible(paramOf(key), {}), key).toBe(true);
    }
  });
});

describe('extrudeMessages', () => {
  /** Every translation key of the schema, groups included. */
  function keys(): readonly string[] {
    return [
      extrudeSchema.label,
      ...Object.values(extrudeSchema.params).flatMap((spec) => [
        spec.label,
        ...(spec.group === undefined ? [] : [spec.group]),
        ...(spec.kind === 'enum' ? spec.options.map((o) => o.label) : []),
      ]),
      // The issue code of the builder for an unusable face.
      'extrude.upToFace',
    ];
  }

  it.each(['cs', 'en'] as const)('%s has a text for every key', (lang) => {
    for (const key of keys()) {
      expect(extrudeMessages[lang][key], `${lang}: ${key}`).toEqual(expect.any(String));
      expect(extrudeMessages[lang][key], `${lang}: ${key}`).not.toBe('');
    }
  });

  it('has the texts of the plan', () => {
    expect(extrudeMessages.cs).toEqual({
      'extrude.label': 'Vysunutí',
      'extrude.regions': 'Oblasti',
      'extrude.operation': 'Operace',
      'extrude.operation.new': 'Nové těleso',
      'extrude.operation.add': 'Přidat',
      'extrude.operation.remove': 'Odebrat',
      'extrude.operation.intersect': 'Průnik',
      'extrude.targets': 'Sloučit s',
      'extrude.group.merge': 'Cílová tělesa',
      'extrude.endType': 'Konec',
      'extrude.endType.blind': 'Do vzdálenosti',
      'extrude.endType.symmetric': 'Symetricky',
      'extrude.endType.upToFace': 'Po plochu',
      'extrude.distance': 'Vzdálenost',
      'extrude.upTo': 'Plocha',
      'extrude.upToFace': 'Plocha musí být rovinná, rovnoběžná se skicou a ve směru vysunutí',
      'extrude.flip': 'Opačný směr',
    });
    expect(extrudeMessages.en).toEqual({
      'extrude.label': 'Extrude',
      'extrude.regions': 'Regions',
      'extrude.operation': 'Operation',
      'extrude.operation.new': 'New body',
      'extrude.operation.add': 'Add',
      'extrude.operation.remove': 'Remove',
      'extrude.operation.intersect': 'Intersect',
      'extrude.targets': 'Merge with',
      'extrude.group.merge': 'Target bodies',
      'extrude.endType': 'End type',
      'extrude.endType.blind': 'Blind',
      'extrude.endType.symmetric': 'Symmetric',
      'extrude.endType.upToFace': 'Up to face',
      'extrude.distance': 'Distance',
      'extrude.upTo': 'Face',
      'extrude.upToFace':
        'The face must be planar, parallel to the sketch and in the extrude direction',
      'extrude.flip': 'Opposite direction',
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(extrudeMessages)).toBe(true);
    expect(Object.isFrozen(extrudeMessages.cs)).toBe(true);
    expect(Object.isFrozen(extrudeMessages.en)).toBe(true);
  });
});

describe('extrudeBuilder', () => {
  it('a rectangle 40 × 20 on XY gives the body of the feature [0, 40] × [0, 20] × [0, 10]', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await rectangleState(kernel);

    const out = await build(anExtrude('e'), state, kernel);

    const body = bodyOf(out, 'e');
    expect(body).toMatchObject({ id: 'e/body', origin: 'e', lastModifiedBy: 'e' });
    expect(await fake.boundingBox(body.shape)).toEqual({ min: [0, 0, 0], max: [40, 20, 10] });
    expect(fake.callCount('extrude')).toBe(1);
    expect(fake.callCount('transform')).toBe(0);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('keeps the sketch and the input state as they are', async () => {
    const { kernel } = aRecordingKernel();
    const state = await rectangleState(kernel);
    const before = [...state.artifacts.entries()];

    const out = await build(anExtrude('e'), state, kernel);

    expect([...out.artifacts.keys()]).toEqual(['s/sketch', 'e/body']);
    expect(out.artifacts.get('s/sketch' as ArtifactId)).toBe(
      state.artifacts.get('s/sketch' as ArtifactId),
    );
    expect([...state.artifacts.entries()]).toEqual(before);
  });

  it('flip extrudes against the normal: z ∈ [−10, 0]', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await rectangleState(kernel);

    const out = await build(anExtrude('e', { flip: true }), state, kernel);

    expect(await fake.boundingBox(bodyOf(out, 'e').shape)).toEqual({
      min: [0, 0, -10],
      max: [40, 20, 0],
    });
  });

  it('symmetric moves the face by half the distance back first: z ∈ [−5, 5]', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await rectangleState(kernel);

    const out = await build(anExtrude('e', { endType: 'symmetric' }), state, kernel);

    expect(await fake.boundingBox(bodyOf(out, 'e').shape)).toEqual({
      min: [0, 0, -5],
      max: [40, 20, 5],
    });
    expect(fake.callCount('transform')).toBe(1);
  });

  it('symmetric ignores a flip that stayed set', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await rectangleState(kernel);

    const out = await build(anExtrude('e', { endType: 'symmetric', flip: true }), state, kernel);

    expect(await fake.boundingBox(bodyOf(out, 'e').shape)).toEqual({
      min: [0, 0, -5],
      max: [40, 20, 5],
    });
  });

  it('a sketch on XZ extrudes along its normal −Y: y ∈ [−10, 0]', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await rectangleState(kernel, originPlane(XZ));

    const out = await build(anExtrude('e'), state, kernel);

    expect(await fake.boundingBox(bodyOf(out, 'e').shape)).toEqual({
      min: [0, -10, 0],
      max: [40, 0, 20],
    });
  });

  it('two regions give one body through one union', async () => {
    const { fake, kernel, calls } = aRecordingKernel();
    const xy = originPlane(XY);
    const r1 = await rectangle(kernel, xy, [0, 0], [10, 10]);
    const r2 = await rectangle(kernel, xy, [20, 0], [10, 10]);
    const state = stateOf(aSketchArtifact('s', [r1, r2]));

    const out = await build(
      anExtrude('e', { regions: [region('r1'), region('r2')] }),
      state,
      kernel,
    );

    expect(fake.callCount('extrude')).toBe(2);
    expect(calls.map((c) => c.op)).toEqual(['union']);
    expect([...out.artifacts.keys()]).toEqual(['s/sketch', 'e/body']);
    expect(await fake.boundingBox(bodyOf(out, 'e').shape)).toEqual({
      min: [0, 0, 0],
      max: [30, 10, 10],
    });
  });

  it('add unites the prism with the target, which keeps its identity', async () => {
    const { fake, kernel, calls } = aRecordingKernel();
    const box = await boxBody(kernel, 'k', [0, 0, -10], [40, 20, 10]);
    const face = await rectangle(kernel, originPlane(XY), [0, 0], [40, 20]);
    const state = stateOf(box, aSketchArtifact('s', [face]));

    const out = await build(
      anExtrude('e', { operation: 'add', targets: [bodyRef('k')] }),
      state,
      kernel,
    );

    expect(calls).toEqual([{ op: 'union', targets: [box.shape], tools: [expect.anything()] }]);
    const body = bodyOf(out, 'k');
    // The names are recomputed from the kernel history (M14), the identity stays.
    expect(body).toEqual({ ...box, shape: body.shape, names: body.names, lastModifiedBy: 'e' });
    expect([...body.names.faceEntries]).toEqual([...box.names.faceEntries]);
    expect(out.artifacts.has(bodyId('e' as FeatureId))).toBe(false);
    expect(await fake.boundingBox(body.shape)).toEqual({ min: [0, 0, -10], max: [40, 20, 10] });
  });

  it('remove subtracts the prism from the target, which keeps its identity', async () => {
    const { kernel, calls } = aRecordingKernel();
    const box = await boxBody(kernel, 'k', [0, 0, 0], [40, 20, 10]);
    const face = await rectangle(kernel, originPlane(XY), [5, 5], [2, 2]);
    const state = stateOf(box, aSketchArtifact('s', [face]));

    const out = await build(
      anExtrude('e', { operation: 'remove', targets: [bodyRef('k')] }),
      state,
      kernel,
    );

    expect(calls).toEqual([{ op: 'subtract', targets: [box.shape], tools: [expect.anything()] }]);
    const body = bodyOf(out, 'k');
    // The names are recomputed from the kernel history (M14), the identity stays.
    expect(body).toEqual({ ...box, shape: body.shape, names: body.names, lastModifiedBy: 'e' });
    expect([...body.names.faceEntries]).toEqual([...box.names.faceEntries]);
    expect([...out.artifacts.keys()]).toEqual(['k/body', 's/sketch']);
  });

  it('intersect keeps the common part in the target', async () => {
    const { fake, kernel, calls } = aRecordingKernel();
    const box = await boxBody(kernel, 'k', [0, 0, 0], [40, 20, 5]);
    const face = await rectangle(kernel, originPlane(XY), [10, 0], [10, 20]);
    const state = stateOf(box, aSketchArtifact('s', [face]));

    const out = await build(
      anExtrude('e', { operation: 'intersect', targets: [bodyRef('k')] }),
      state,
      kernel,
    );

    expect(calls.map((c) => c.op)).toEqual(['intersect']);
    const body = bodyOf(out, 'k');
    expect(body.lastModifiedBy).toBe('e');
    expect(await fake.boundingBox(body.shape)).toEqual({ min: [10, 0, 0], max: [20, 20, 5] });
  });

  it('an unresolved region gives UNRESOLVED_REFERENCE at regions without calling the kernel', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await rectangleState(kernel);

    const output = await run(anExtrude('e', { regions: [region('r9')] }), state, kernel);

    if (output.ok) expect.fail('Expected an error');
    expect(output.error).toMatchObject({
      code: 'UNRESOLVED_REFERENCE',
      issues: [{ param: 'regions', code: 'param.unresolvedRef' }],
    });
    expect(fake.callCount('extrude')).toBe(0);
  });

  it('an unresolved target gives UNRESOLVED_REFERENCE at targets without calling the kernel', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await rectangleState(kernel);

    const output = await run(
      anExtrude('e', { operation: 'add', targets: [bodyRef('x')] }),
      state,
      kernel,
    );

    if (output.ok) expect.fail('Expected an error');
    expect(output.error).toMatchObject({
      code: 'UNRESOLVED_REFERENCE',
      issues: [{ param: 'targets', code: 'param.unresolvedRef' }],
    });
    expect(fake.callCount('extrude')).toBe(0);
  });

  it('a new body with an invalid hidden targets passes validation and build', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await rectangleState(kernel);
    const params = { ...anExtrude('e').params, targets: [bodyRef('x'), { kind: 'body' }] };
    expect(extrudeSchema.validate(params)).toEqual([]);
    // The invalid hidden value is what the document may hold; the builder must not read it.
    const feature = aFeature({
      id: 'e',
      type: 'extrude',
      params: params as unknown as ExtrudeParams,
    });

    const out = await build(feature, state, kernel);

    expect(await fake.boundingBox(bodyOf(out, 'e').shape)).toEqual({
      min: [0, 0, 0],
      max: [40, 20, 10],
    });
  });

  it('lets an error of the kernel through', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await rectangleState(kernel);
    fake.failNext('extrude', 'operation-failed');

    await expect(run(anExtrude('e'), state, kernel)).rejects.toMatchObject({
      code: 'operation-failed',
    });
  });
});

describe('extrudeBuilder up to face', () => {
  const BOTTOM = 'b/face:bottom';
  const target = topoRef('b/body', BOTTOM);

  const bottomFace: FaceInfo = {
    surface: 'plane',
    plane: { origin: [0, 0, 5], normal: [0, 0, -1] },
  };

  /** The rectangle state with a box body 'b' z ∈ [5, 15] whose face 0 named BOTTOM is `face`. */
  async function stateWithTarget(kernel: ModelingKernel, face: FaceInfo): Promise<RegenState> {
    const sketch = await rectangleState(kernel);
    const names = aNameTable({
      faces: { [BOTTOM]: [0] },
      topology: { faces: [face], edges: [], vertexCount: 0 },
    });
    const body = await boxBody(kernel, 'b', [-10, -10, 5], [60, 40, 10], names);
    return stateOf(...sketch.artifacts.values(), body);
  }

  function upToFace(params: Partial<ExtrudeParams> = {}): FeatureInstance<ExtrudeParams> {
    return anExtrude('e', { endType: 'upToFace', upTo: [target], ...params });
  }

  async function expectUnusableFace(face: FaceInfo): Promise<void> {
    const { fake, kernel } = aRecordingKernel();
    const state = await stateWithTarget(kernel, face);

    const output = await run(upToFace(), state, kernel);

    if (output.ok) expect.fail('Expected an error');
    const { message, ...rest } = output.error;
    expect(rest).toEqual({
      code: 'INVALID_PARAMS',
      issues: [{ param: 'upTo', code: 'extrude.upToFace' }],
    });
    expect(message).toContain(BOTTOM);
    expect(Object.isFrozen(output.error)).toBe(true);
    expect(fake.callCount('extrude')).toBe(0);
  }

  it('extrudes a rectangle on XY up to the bottom face z = 5 of a box: z ∈ [0, 5]', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await stateWithTarget(kernel, bottomFace);

    const out = await build(upToFace(), state, kernel);

    expect(await fake.boundingBox(bodyOf(out, 'e').shape)).toEqual({
      min: [0, 0, 0],
      max: [40, 20, 5],
    });
    expect(fake.callCount('transform')).toBe(0);
  });

  it('gives empty anchors (no handle for up to face)', async () => {
    const { kernel } = aRecordingKernel();
    const state = await stateWithTarget(kernel, bottomFace);

    const output = await run(upToFace(), state, kernel);

    if (!output.ok) expect.fail(`Unexpected build error: ${output.error.message}`);
    expect(output.anchors).toEqual({});
  });

  it('ignores the hidden distance and flip', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await stateWithTarget(kernel, bottomFace);

    const out = await build(upToFace({ distance: 99, flip: true }), state, kernel);

    expect(await fake.boundingBox(bodyOf(out, 'e').shape)).toEqual({
      min: [0, 0, 0],
      max: [40, 20, 5],
    });
  });

  it('a parallel face with the normal along the direction is usable too', async () => {
    const { fake, kernel } = aRecordingKernel();
    const top: FaceInfo = { surface: 'plane', plane: { origin: [3, 7, 15], normal: [0, 0, 1] } };
    const state = await stateWithTarget(kernel, top);

    const out = await build(upToFace(), state, kernel);

    expect(await fake.boundingBox(bodyOf(out, 'e').shape)).toEqual({
      min: [0, 0, 0],
      max: [40, 20, 15],
    });
  });

  it('measures the distance from the plane of each region', async () => {
    const { fake, kernel } = aRecordingKernel();
    // A second sketch 't' parallel to XY at z = 2: its prism is 3 high, not 5.
    const lifted: Plane = { ...originPlane(XY), origin: [0, 0, 2] };
    const face = await rectangle(kernel, lifted, [50, 0], [10, 10]);
    const base = await stateWithTarget(kernel, bottomFace);
    const state = stateOf(
      ...base.artifacts.values(),
      aSketchArtifact('t', [face], { plane: lifted }),
    );

    const out = await build(
      upToFace({ regions: [region('r1', 's'), region('r1', 't')] }),
      state,
      kernel,
    );

    expect(await fake.boundingBox(bodyOf(out, 'e').shape)).toEqual({
      min: [0, 0, 0],
      max: [60, 20, 5],
    });
    expect(fake.callCount('extrude')).toBe(2);
  });

  it('a face behind the profile gives INVALID_PARAMS at upTo', async () => {
    await expectUnusableFace({
      surface: 'plane',
      plane: { origin: [0, 0, -5], normal: [0, 0, 1] },
    });
  });

  it('a face in the plane of the profile gives INVALID_PARAMS at upTo', async () => {
    await expectUnusableFace({
      surface: 'plane',
      plane: { origin: [5, 5, 0], normal: [0, 0, -1] },
    });
  });

  it('a slanted face gives INVALID_PARAMS at upTo', async () => {
    await expectUnusableFace({
      surface: 'plane',
      plane: { origin: [0, 0, 5], normal: vec3.normalize([0, 1, -1]) },
    });
  });

  it('a non-planar face gives UNRESOLVED_REFERENCE at upTo, as resolvePlanes rejects it', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await stateWithTarget(kernel, { surface: 'cylinder' });

    const output = await run(upToFace(), state, kernel);

    if (output.ok) expect.fail('Expected an error');
    expect(output.error).toEqual({
      code: 'UNRESOLVED_REFERENCE',
      message: `Face '${BOTTOM}' is not planar`,
      issues: [{ param: 'upTo', code: 'param.unresolvedRef' }],
    });
    expect(fake.callCount('extrude')).toBe(0);
  });

  // The warning of several faces is resolvePlanes's (build-context.test.ts); aBuildContext drops it.
  it('a name on several faces uses the face with the smallest index', async () => {
    const { fake, kernel } = aRecordingKernel();
    const sketch = await rectangleState(kernel);
    const top: FaceInfo = { surface: 'plane', plane: { origin: [0, 0, 15], normal: [0, 0, 1] } };
    const names = aNameTable({
      faces: { [BOTTOM]: [0, 1] },
      topology: { faces: [bottomFace, top], edges: [], vertexCount: 0 },
    });
    const body = await boxBody(kernel, 'b', [-10, -10, 5], [60, 40, 10], names);
    const state = stateOf(...sketch.artifacts.values(), body);

    const out = await build(upToFace(), state, kernel);

    expect(await fake.boundingBox(bodyOf(out, 'e').shape)).toEqual({
      min: [0, 0, 0],
      max: [40, 20, 5],
    });
  });

  it('a missing name gives UNRESOLVED_REFERENCE at upTo without calling the kernel', async () => {
    const { fake, kernel } = aRecordingKernel();
    const state = await stateWithTarget(kernel, bottomFace);

    const output = await run(
      upToFace({ upTo: [topoRef('b/body', 'b/face:nowhere')] }),
      state,
      kernel,
    );

    if (output.ok) expect.fail('Expected an error');
    expect(output.error).toMatchObject({
      code: 'UNRESOLVED_REFERENCE',
      issues: [{ param: 'upTo', code: 'param.unresolvedRef' }],
    });
    expect(fake.callCount('extrude')).toBe(0);
  });
});

describe('extrudeBuilder anchors', () => {
  async function anchorsOf(
    feature: FeatureInstance<ExtrudeParams>,
    state: RegenState,
    kernel: ModelingKernel,
  ) {
    const output = await run(feature, state, kernel);
    if (!output.ok) expect.fail(`Unexpected build error: ${output.error.message}`);
    return output.anchors;
  }

  it('blind: base at the center of the region in the sketch plane, along the normal', async () => {
    const { kernel } = aRecordingKernel();
    const state = await rectangleState(kernel);

    const anchors = await anchorsOf(anExtrude('e'), state, kernel);

    expect(Object.keys(anchors)).toEqual(['base']);
    expectVec(anchors.base?.point, [20, 10, 0]);
    expectVec(anchors.base?.direction, [0, 0, 1]);
  });

  it('blind with flip: the direction is still the normal, handles() applies flip', async () => {
    const { kernel } = aRecordingKernel();
    const state = await rectangleState(kernel);

    const anchors = await anchorsOf(anExtrude('e', { flip: true }), state, kernel);

    expectVec(anchors.base?.point, [20, 10, 0]);
    expectVec(anchors.base?.direction, [0, 0, 1]);
  });

  it('symmetric: base in the sketch plane along the normal, a set flip is ignored', async () => {
    const { kernel } = aRecordingKernel();
    const state = await rectangleState(kernel);

    for (const flip of [false, true]) {
      const feature = anExtrude('e', { endType: 'symmetric', flip });
      const anchors = await anchorsOf(feature, state, kernel);
      expectVec(anchors.base?.point, [20, 10, 0]);
      expectVec(anchors.base?.direction, [0, 0, 1]);
    }
  });

  it('a sketch on XZ has the direction −Y', async () => {
    const { kernel } = aRecordingKernel();
    const state = await rectangleState(kernel, originPlane(XZ));

    const anchors = await anchorsOf(anExtrude('e'), state, kernel);

    expectVec(anchors.base?.point, [20, 0, 10]);
    expectVec(anchors.base?.direction, [0, -1, 0]);
  });

  it('two regions: the center of their joined bounding box', async () => {
    const { kernel } = aRecordingKernel();
    const xy = originPlane(XY);
    const a = await rectangle(kernel, xy, [0, 0], [10, 10]);
    const b = await rectangle(kernel, xy, [30, 20], [10, 10]);
    const state = stateOf(aSketchArtifact('s', [a, b], { plane: xy }));

    const anchors = await anchorsOf(
      anExtrude('e', { regions: [region('r1'), region('r2')] }),
      state,
      kernel,
    );

    expectVec(anchors.base?.point, [20, 15, 0]);
  });

  it('the base lies in a slanted sketch plane away from the origin', async () => {
    const { kernel } = aRecordingKernel();
    const [s2, s3] = [Math.SQRT1_2, 1 / Math.sqrt(3)];
    const plane: Plane = { origin: [3, 4, 5], xDir: [s2, -s2, 0], normal: [s3, s3, s3] };
    // Two regions of different size: the center of their joined box is off the plane.
    const a = await rectangle(kernel, plane, [0, 0], [10, 10]);
    const b = await rectangle(kernel, plane, [20, -30], [1, 1]);
    const state = stateOf(aSketchArtifact('s', [a, b], { plane }));

    const anchors = await anchorsOf(
      anExtrude('e', { regions: [region('r1'), region('r2')] }),
      state,
      kernel,
    );

    const base = anchors.base;
    if (base === undefined) expect.fail('No anchor base');
    expect(Math.abs(vec3.dot(vec3.sub(base.point, plane.origin), plane.normal))).toBeLessThan(1e-9);
    expectVec(base.direction, plane.normal);
  });

  it('the anchor does not depend on the distance (spec 07, anchor invariant)', async () => {
    const { kernel } = aRecordingKernel();
    const state = await rectangleState(kernel);

    for (const endType of ['blind', 'symmetric'] as const) {
      const near = await anchorsOf(anExtrude('e', { endType, distance: 2 }), state, kernel);
      const far = await anchorsOf(anExtrude('e', { endType, distance: 37 }), state, kernel);
      expect(near.base, endType).toBeDefined();
      expect(far, endType).toEqual(near);
    }
  });
});

describe('extrudeManipulators', () => {
  // The anchor carries the sketch normal; flip comes from the live params (spec 07).
  const ANCHORS = { base: { point: [1, 2, 3] as Vec3, direction: [0, 0, 1] as Vec3 } };

  /** The handles of the frame (M19); the extrude has no modes, so the mode is ''. */
  function handlesOf(params: ExtrudeParams): readonly Handle[] {
    const frame = extrudeManipulators.frame(anEvaluated(params), ANCHORS, '');
    if (frame === null) expect.fail('no frame');
    return frame.handles;
  }

  function only(handles: readonly Handle[]): LinearHandle {
    expect(handles.map((h) => h.id)).toEqual(['distance']);
    const [h] = handles;
    if (h?.kind !== 'linear') expect.fail('distance is not linear');
    return h;
  }

  it('has no modes', () => {
    expect(extrudeManipulators.modes).toBeUndefined();
  });

  it('gives no frame without the anchor base', () => {
    expect(extrudeManipulators.frame(anEvaluated(anExtrude('e').params), {}, '')).toBeNull();
  });

  it('the center of the frame is the base point', () => {
    expect(
      extrudeManipulators.frame(anEvaluated(anExtrude('e').params), ANCHORS, '')?.center,
    ).toEqual([1, 2, 3]);
  });

  it('blind: one neutral length arrow at base + d·distance with min 0.01', () => {
    const h = only(handlesOf(anExtrude('e', { distance: 10 }).params));
    expect(h).toMatchObject({ unit: 'length', tint: 'neutral', min: 0.01, value: 10 });
    expectVec(h.position, [1, 2, 13]);
    expect(h.direction).toEqual([0, 0, 1]);
    expect(h.toParams(12)).toEqual({ distance: 12 });
    expect(h.displayScale ?? 1).toBe(1);
  });

  it('blind with flip: the arrow points against the normal of the anchor', () => {
    const params = anExtrude('e', { distance: 10, flip: true }).params;
    const h = only(handlesOf(params));
    expectVec(h.position, [1, 2, -7]);
    expectVec(h.direction, [0, 0, -1]);
    expect(h.value).toBe(10);
    expect(h.toParams(12)).toEqual({ distance: 12 });
  });

  it('symmetric: the arrow at base + d·distance/2, the field shows the whole distance', () => {
    const params = anExtrude('e', { endType: 'symmetric', distance: 10 }).params;
    const h = only(handlesOf(params));
    expect(h).toMatchObject({ unit: 'length', tint: 'neutral', min: 0.01, value: 5 });
    expectVec(h.position, [1, 2, 8]);
    expect(h.direction).toEqual([0, 0, 1]);
    expect(h.toParams(6)).toEqual({ distance: 12 });
    expect(h.displayScale).toBe(2);
  });

  it('symmetric ignores a set flip: the arrow goes along the normal', () => {
    const params = anExtrude('e', { endType: 'symmetric', distance: 10, flip: true }).params;
    const h = only(handlesOf(params));
    expectVec(h.position, [1, 2, 8]);
    expectVec(h.direction, [0, 0, 1]);
  });

  it('up to face gives no frame even with an old anchor base', () => {
    const params = anExtrude('e', { endType: 'upToFace' }).params;
    expect(extrudeManipulators.frame(anEvaluated(params), ANCHORS, '')).toBeNull();
  });

  it('the frame and the handles are frozen', () => {
    const frame = extrudeManipulators.frame(anEvaluated(anExtrude('e').params), ANCHORS, '');
    expect(Object.isFrozen(frame)).toBe(true);
    const handles = handlesOf(anExtrude('e').params);
    expect(Object.isFrozen(handles)).toBe(true);
    const h = only(handles);
    expect(Object.isFrozen(h)).toBe(true);
    expect(Object.isFrozen(h.position)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------

/** A FeatureEditor that records create calls; `open` pretends a session is already open. */
function aRecordingEditor(open = false) {
  const created: string[] = [];
  const session: FeatureEditSession = {
    mode: 'create',
    featureId: aFeature().id,
    schema: extrudeSchema,
    state: new ObservableValue({
      params: {},
      issues: [],
      fields: [],
      activeRefParam: null,
      open: true,
      name: 'Extrude 1',
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
  registry.register(extrudeTool);
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

describe('extrudeTool', () => {
  it('is the feature tool extrude with the shortcut Shift+E', () => {
    expect(extrudeTool).toMatchObject({
      id: 'extrude',
      label: 'extrude.label',
      icon: 'arrow-big-up-lines',
      group: 'feature',
      shortcut: 'Shift+E',
    });
    expect(Object.isFrozen(extrudeTool)).toBe(true);
  });

  it('labels the tool with a key the extrude messages translate (ADR 0014)', () => {
    expect(extrudeMessages.cs[extrudeTool.label]).toBe('Vysunutí');
    expect(extrudeMessages.en[extrudeTool.label]).toBe('Extrude');
  });

  it('opens the dialog for a new extrude and returns to the default tool', () => {
    const { editor, created } = aRecordingEditor();
    const { manager, emitted } = aToolManager(editor);

    manager.activate('extrude');

    expect(created).toEqual(['extrude']);
    expect(emitted).toEqual(['extrude', 'select']);
  });

  it('only finishes while another session is open', () => {
    const { editor, created } = aRecordingEditor(true);
    const { manager, emitted } = aToolManager(editor);

    manager.activate('extrude');

    expect(created).toEqual([]);
    expect(emitted).toEqual(['extrude', 'select']);
  });

  it('creates a new tool on every activation', () => {
    expect(extrudeTool.create()).not.toBe(extrudeTool.create());
  });
});
