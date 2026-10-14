import { describe, expect, it } from 'vitest';
import {
  ORIGIN_AXIS_IDS,
  ORIGIN_PLANES,
  ORIGIN_PLANE_IDS,
  createFeatureSchemaRegistry,
  sketchId,
} from '@/document';
import type { FeatureInstance, PlaneId, PlaneRef } from '@/document';
import { aFeature } from '@/document/testing';
import { createToolRegistry } from '@/interaction';
import { createFakeKernel } from '@/kernel/testing';
import type { FakeKernel } from '@/kernel/testing';
import { registerPlugin } from '@/plugin-api';
import { EMPTY_STATE, createBuilderRegistry, sketchesOf } from '@/regen';
import type { BuildContext, RegenState, SketchArtifact } from '@/regen';
import { aBuildContext, aRegenSetup, resized, result } from '@/regen/testing';
import { SKETCH_FEATURE_TYPE, parseSketchData } from '@/sketch';
import type { SketchData, SketchEntity, SketchEntityId } from '@/sketch';
import { rectangleData } from '@/sketch/testing';
import { sketchBuilder } from './builder';
import { sketchMessages } from './messages';
import { sketchSchema } from './schema';
import type { SketchParams } from './schema';
import * as sketch from '.';

function planeRef(id: string): PlaneRef {
  // Test data: the id has the shape of a plane id, the document checks it at its boundary.
  return { kind: 'plane', plane: id as PlaneId };
}

function aSketch(
  id: string,
  data: SketchData = rectangleData(),
  plane: string = ORIGIN_PLANE_IDS.xy,
): FeatureInstance<SketchParams> {
  return aFeature({
    id,
    type: SKETCH_FEATURE_TYPE,
    params: { plane: [planeRef(plane)], entities: data.entities, constraints: data.constraints },
  });
}

/** Raw entities and constraints branded through the one trusted parser; bad test data fails. */
function sketchData(
  entities: readonly unknown[],
  constraints: readonly unknown[] = [],
): SketchData {
  const parsed = parseSketchData(entities, constraints);
  if (!parsed.ok) expect.fail(`Invalid test sketch: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

/** The default rectangle 10 × 5 with a circle of radius 2 inside it. */
function rectangleWithCircle(): SketchData {
  const rect = rectangleData();
  return sketchData(
    [
      ...rect.entities,
      { kind: 'point', id: 'o', x: 5, y: 2.5 },
      { kind: 'circle', id: 'k', center: 'o', radius: 2 },
    ],
    rect.constraints,
  );
}

/** A closed bow tie: the lines ab and cd cross each other. */
function bowTie(): SketchData {
  return sketchData([
    { kind: 'point', id: 'a', x: 0, y: 0 },
    { kind: 'point', id: 'b', x: 10, y: 10 },
    { kind: 'point', id: 'c', x: 10, y: 0 },
    { kind: 'point', id: 'd', x: 0, y: 10 },
    { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
    { kind: 'line', id: 'bc', p1: 'b', p2: 'c' },
    { kind: 'line', id: 'cd', p1: 'c', p2: 'd' },
    { kind: 'line', id: 'da', p1: 'd', p2: 'a' },
  ]);
}

/** A BuildContext over `kernel` and `state` that records the warnings. */
function aRecordingContext(
  kernel: FakeKernel,
  state: RegenState = EMPTY_STATE,
): { ctx: BuildContext; warnings: string[] } {
  const warnings: string[] = [];
  const base = aBuildContext(kernel, state);
  const ctx: BuildContext = {
    ...base,
    warn: (message) => {
      warnings.push(message);
    },
  };
  return { ctx, warnings };
}

async function build(
  feature: FeatureInstance<SketchParams>,
  kernel: FakeKernel = createFakeKernel(),
): Promise<SketchArtifact> {
  const output = await sketchBuilder.build({ feature, state: EMPTY_STATE }, aBuildContext(kernel));
  if (!output.ok) expect.fail(`Unexpected build error: ${output.error.message}`);
  const artifact = output.state.artifacts.get(sketchId(feature.id));
  if (artifact?.kind !== 'sketch') expect.fail('No sketch artifact');
  return artifact;
}

describe('sketch public API', () => {
  it('exports exactly sketchPlugin', () => {
    expect(Object.keys(sketch)).toEqual(['sketchPlugin']);
  });

  it('sketchPlugin joins the schema, the builder and the messages of type sketch', () => {
    expect(sketch.sketchPlugin.schema).toBe(sketchSchema);
    expect(sketch.sketchPlugin.builder).toBe(sketchBuilder);
    expect(sketch.sketchPlugin.messages).toBe(sketchMessages);
    expect(sketchSchema.type).toBe(SKETCH_FEATURE_TYPE);
    expect(sketchBuilder.type).toBe(SKETCH_FEATURE_TYPE);
  });

  it('has no tools: entering the sketcher is a built-in tool of interaction (ADR 0017)', () => {
    expect(sketch.sketchPlugin.tools).toBeUndefined();
  });

  it('is frozen', () => {
    expect(Object.isFrozen(sketch.sketchPlugin)).toBe(true);
  });

  it('registers schema and builder through registerPlugin and adds no tool', () => {
    const regs = {
      schemas: createFeatureSchemaRegistry(),
      builders: createBuilderRegistry(),
      tools: createToolRegistry(),
    };
    registerPlugin(sketch.sketchPlugin, regs);
    expect(regs.schemas.get(SKETCH_FEATURE_TYPE)).toBe(sketchSchema);
    expect(regs.builders.get(SKETCH_FEATURE_TYPE)).toBe(sketchBuilder);
    expect(regs.tools.all()).toEqual([]);
  });
});

describe('sketchSchema', () => {
  it('is version 1 of type sketch with the icon pencil', () => {
    expect(sketchSchema).toMatchObject({
      type: 'sketch',
      version: 1,
      label: 'sketch.label',
      icon: 'pencil',
    });
  });

  it('has the params plane, entities, constraints in this order', () => {
    expect(sketchSchema.params).toEqual({
      plane: { kind: 'planes', label: 'sketch.plane', min: 1, max: 1 },
      entities: { kind: 'data', label: 'sketch.entities' },
      constraints: { kind: 'data', label: 'sketch.constraints' },
    });
    expect(Object.keys(sketchSchema.params)).toEqual(['plane', 'entities', 'constraints']);
  });

  it('is frozen deeply', () => {
    expect(Object.isFrozen(sketchSchema)).toBe(true);
    expect(Object.isFrozen(sketchSchema.params)).toBe(true);
    for (const [key, spec] of Object.entries(sketchSchema.params)) {
      expect(Object.isFrozen(spec), key).toBe(true);
    }
  });

  it('defaults are an empty sketch on the origin plane XY and pass validation', () => {
    const defaults = sketchSchema.defaults();
    expect(defaults).toEqual({
      plane: [{ kind: 'plane', plane: 'origin/plane:xy' }],
      entities: [],
      constraints: [],
    });
    expect(sketchSchema.validate(defaults)).toEqual([]);
  });

  it('defaults returns a new object every call', () => {
    const a = sketchSchema.defaults();
    const b = sketchSchema.defaults();
    expect(a).not.toBe(b);
    expect(a.plane).not.toBe(b.plane);
    expect(a).toEqual(b);
  });

  it('accepts a valid sketch', () => {
    expect(sketchSchema.validate(aSketch('s1', rectangleWithCircle()).params)).toEqual([]);
  });

  it('rejects no plane and two planes', () => {
    const defaults = sketchSchema.defaults();
    expect(sketchSchema.validate({ ...defaults, plane: [] })).toEqual([
      { param: 'plane', code: 'param.tooFewRefs', params: { min: 1 } },
    ]);
    const two = [planeRef(ORIGIN_PLANE_IDS.xy), planeRef(ORIGIN_PLANE_IDS.xz)];
    expect(sketchSchema.validate({ ...defaults, plane: two }).map((i) => i.param)).toEqual([
      'plane',
    ]);
  });

  it('turns invalid entities into issues at entities with the index', () => {
    const rect = rectangleData();
    const entities = [
      ...rect.entities,
      { kind: 'point', id: 'e', x: Number.NaN, y: 0 },
      { kind: 'line', id: 'bad', p1: 'a', p2: 'a' },
    ];
    expect(sketchSchema.validate({ ...sketchSchema.defaults(), entities })).toEqual([
      { param: 'entities', code: 'sketch.invalidEntity', params: { index: 8 } },
      { param: 'entities', code: 'sketch.invalidEntity', params: { index: 9 } },
    ]);
  });

  it('turns invalid constraints into issues at constraints with the index', () => {
    const rect = rectangleData();
    const constraints = [
      { kind: 'horizontal', id: 'h', line: 'a' },
      ...rect.constraints,
      { kind: 'radius', id: 'r', curve: 'ab', value: 2 },
    ];
    expect(
      sketchSchema.validate({ ...sketchSchema.defaults(), entities: rect.entities, constraints }),
    ).toEqual([
      { param: 'constraints', code: 'sketch.invalidConstraint', params: { index: 0 } },
      { param: 'constraints', code: 'sketch.invalidConstraint', params: { index: 5 } },
    ]);
  });

  it('a field that is not an array gives one issue with index -1', () => {
    expect(sketchSchema.validate({ ...sketchSchema.defaults(), entities: {} })).toEqual([
      { param: 'entities', code: 'sketch.invalidEntity', params: { index: -1 } },
    ]);
  });

  it('checks the sketch data only when both entities and constraints are present', () => {
    expect(sketchSchema.validate({ plane: [planeRef(ORIGIN_PLANE_IDS.xy)], entities: 5 })).toEqual([
      { param: 'constraints', code: 'param.missing' },
    ]);
  });

  it('rejects params that are not an object, missing and unexpected params', () => {
    expect(sketchSchema.validate(null)).not.toEqual([]);
    const { plane, entities } = sketchSchema.defaults();
    expect(sketchSchema.validate({ plane, entities }).map((i) => i.param)).toEqual(['constraints']);
    expect(
      sketchSchema.validate({ ...sketchSchema.defaults(), extra: 1 }).map((i) => i.param),
    ).toEqual(['extra']);
  });
});

describe('sketchMessages', () => {
  const KEYS = [
    'sketch.label',
    'sketch.plane',
    'sketch.entities',
    'sketch.constraints',
    'sketch.invalidEntity',
    'sketch.invalidConstraint',
  ];

  it.each(['cs', 'en'] as const)('%s has a text for every key of the schema', (lang) => {
    const keys = [sketchSchema.label, ...Object.values(sketchSchema.params).map((s) => s.label)];
    for (const key of keys) {
      expect(sketchMessages[lang][key], `${lang}: ${key}`).toEqual(expect.any(String));
    }
  });

  it('cs and en have exactly the keys of the plan', () => {
    expect(Object.keys(sketchMessages.cs).sort()).toEqual([...KEYS].sort());
    expect(Object.keys(sketchMessages.en).sort()).toEqual([...KEYS].sort());
  });

  it('has the texts of the plan', () => {
    expect(sketchMessages.cs).toEqual({
      'sketch.label': 'Skica',
      'sketch.plane': 'Rovina',
      'sketch.entities': 'Entity',
      'sketch.constraints': 'Vazby',
      'sketch.invalidEntity': 'Neplatná entita skici {index}',
      'sketch.invalidConstraint': 'Neplatná vazba skici {index}',
    });
    expect(sketchMessages.en).toEqual({
      'sketch.label': 'Sketch',
      'sketch.plane': 'Plane',
      'sketch.entities': 'Entities',
      'sketch.constraints': 'Constraints',
      'sketch.invalidEntity': 'Invalid sketch entity {index}',
      'sketch.invalidConstraint': 'Invalid sketch constraint {index}',
    });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(sketchMessages)).toBe(true);
    expect(Object.isFrozen(sketchMessages.cs)).toBe(true);
    expect(Object.isFrozen(sketchMessages.en)).toBe(true);
  });
});

describe('sketchBuilder', () => {
  it('a rectangle gives one face and the artifact sketchId(feature) on the plane XY', async () => {
    const kernel = createFakeKernel();
    const feature = aSketch('s1');

    const artifact = await build(feature, kernel);

    expect(kernel.callCount('makeFace')).toBe(1);
    expect(artifact).toMatchObject({ kind: 'sketch', id: 's1/sketch', owner: 's1' });
    expect(artifact.plane).toBe(ORIGIN_PLANES[0]?.plane);
    expect(artifact.entities).toBe(feature.params.entities);
    expect([...artifact.regions.keys()]).toEqual(['ab,bc,cd,da']);
    expect(await kernel.liveHandleCount()).toBe(1);
  });

  it('passes the region loops and the plane to makeFace as they are', async () => {
    const kernel = createFakeKernel();
    const calls: unknown[] = [];
    const ctx: BuildContext = {
      ...aBuildContext(kernel),
      kernel: {
        ...aBuildContext(kernel).kernel,
        makeFace: (p) => {
          calls.push(p);
          return kernel.makeFace(p);
        },
      },
    };
    await sketchBuilder.build({ feature: aSketch('s1'), state: EMPTY_STATE }, ctx);
    expect(calls).toEqual([
      {
        plane: ORIGIN_PLANES[0]?.plane,
        outer: [
          { kind: 'line', from: [0, 0], to: [10, 0] },
          { kind: 'line', from: [10, 0], to: [10, 5] },
          { kind: 'line', from: [10, 5], to: [0, 5] },
          { kind: 'line', from: [0, 5], to: [0, 0] },
        ],
        holes: [],
      },
    ]);
  });

  it('a rectangle with a circle inside gives two faces in the order of the regions', async () => {
    const kernel = createFakeKernel();
    const artifact = await build(aSketch('s1', rectangleWithCircle()), kernel);
    expect(kernel.callCount('makeFace')).toBe(2);
    expect([...artifact.regions.keys()]).toEqual(['ab,bc,cd,da,k', 'k']);
  });

  it('crossing curves give a warning, no face and an artifact without regions', async () => {
    const kernel = createFakeKernel();
    const { ctx, warnings } = aRecordingContext(kernel);
    const output = await sketchBuilder.build(
      { feature: aSketch('s1', bowTie()), state: EMPTY_STATE },
      ctx,
    );
    if (!output.ok) expect.fail(output.error.message);
    expect(warnings).toEqual(['Sketch curves cross each other; no regions']);
    expect(kernel.callCount('makeFace')).toBe(0);
    const artifact = output.state.artifacts.get(sketchId(aSketch('s1').id));
    if (artifact?.kind !== 'sketch') expect.fail('No sketch artifact');
    expect(artifact.regions.size).toBe(0);
  });

  it('an empty sketch is valid: an artifact with no regions and no warning', async () => {
    const kernel = createFakeKernel();
    const { ctx, warnings } = aRecordingContext(kernel);
    const output = await sketchBuilder.build(
      { feature: aSketch('s1', sketchData([])), state: EMPTY_STATE },
      ctx,
    );
    if (!output.ok) expect.fail(output.error.message);
    expect(warnings).toEqual([]);
    expect(kernel.callCount('makeFace')).toBe(0);
    expect(sketchesOf(output.state).map((s) => s.regions.size)).toEqual([0]);
  });

  it('a sketch on the plane XZ carries that plane', async () => {
    const artifact = await build(aSketch('s1', rectangleData(), ORIGIN_PLANE_IDS.xz));
    expect(artifact.plane).toBe(ORIGIN_PLANES[1]?.plane);
  });

  it('an unknown plane gives UNRESOLVED_REFERENCE at plane and calls no kernel op', async () => {
    const kernel = createFakeKernel();
    const calls = kernel.callCount();
    const output = await sketchBuilder.build(
      { feature: aSketch('s1', rectangleData(), 'origin/plane:ab'), state: EMPTY_STATE },
      aBuildContext(kernel),
    );
    if (output.ok) expect.fail('Expected an unresolved reference');
    expect(output.error).toMatchObject({
      code: 'UNRESOLVED_REFERENCE',
      issues: [{ param: 'plane', code: 'param.unresolvedRef' }],
    });
    expect(kernel.callCount()).toBe(calls);
  });

  it('invalid sketch data is a program error and throws', async () => {
    // Test data the validation would reject: a line from a point to itself, the point missing.
    // The ids are branded by hand because parseSketchData refuses to brand them.
    const x = 'x' as SketchEntityId;
    const line: SketchEntity = { kind: 'line', id: 'l' as SketchEntityId, p1: x, p2: x };
    const feature = aFeature<SketchParams>({
      id: 's1',
      type: SKETCH_FEATURE_TYPE,
      params: { ...sketchSchema.defaults(), entities: [line] },
    });
    await expect(
      sketchBuilder.build({ feature, state: EMPTY_STATE }, aBuildContext(createFakeKernel())),
    ).rejects.toThrow();
  });

  it('lets a kernel error fly', async () => {
    const kernel = createFakeKernel();
    kernel.failNext('makeFace', 'operation-failed');
    await expect(
      sketchBuilder.build({ feature: aSketch('s1'), state: EMPTY_STATE }, aBuildContext(kernel)),
    ).rejects.toMatchObject({ code: 'operation-failed' });
  });

  it('keeps the input state as it is and freezes the output state and the artifact', async () => {
    const kernel = createFakeKernel();
    const output = await sketchBuilder.build(
      { feature: aSketch('s1'), state: EMPTY_STATE },
      aBuildContext(kernel),
    );
    if (!output.ok) expect.fail(output.error.message);
    const originKeys = [
      ORIGIN_PLANE_IDS.xy,
      ORIGIN_PLANE_IDS.xz,
      ORIGIN_PLANE_IDS.yz,
      ORIGIN_AXIS_IDS.x,
      ORIGIN_AXIS_IDS.y,
      ORIGIN_AXIS_IDS.z,
    ];
    expect([...EMPTY_STATE.artifacts.keys()]).toEqual(originKeys);
    expect([...output.state.artifacts.keys()]).toEqual([...originKeys, 's1/sketch']);
    expect(Object.isFrozen(output.state)).toBe(true);
    expect(Object.isFrozen(output.state.artifacts.get(sketchId(aSketch('s1').id)))).toBe(true);
  });
});

describe('sketch plugin in the Regenerator', () => {
  function aSetup() {
    const setup = aRegenSetup();
    registerPlugin(sketch.sketchPlugin, {
      schemas: setup.schemas,
      builders: setup.builders,
      tools: createToolRegistry(),
    });
    return setup;
  }

  it('does not rebuild the sketch when only a later feature changes', async () => {
    const { kernel, regenerator } = aSetup();
    const s = aSketch('s1');
    const box = aFeature({ id: 'b1' });

    const first = result(await regenerator.run({ features: [s, box], rollbackIndex: 2 }));
    const second = result(
      await regenerator.run({ features: [s, resized(box, 3)], rollbackIndex: 2 }),
    );

    expect(kernel.callCount('makeFace')).toBe(1);
    expect(sketchesOf(second.finalState)).toEqual(sketchesOf(first.finalState));
    expect(second.statuses.get(s.id)).toEqual({ kind: 'ok' });
  });

  it('a changed dimension gives new faces and releases the old ones', async () => {
    const { kernel, regenerator } = aSetup();
    const narrow = aSketch('s1', rectangleWithCircle());
    const wide = aSketch('s1', rectangleData({ width: 20 }));

    const first = result(await regenerator.run({ features: [narrow], rollbackIndex: 1 }));
    expect(await kernel.liveHandleCount()).toBe(2);
    const second = result(await regenerator.run({ features: [wide], rollbackIndex: 1 }));

    expect(kernel.callCount('makeFace')).toBe(3);
    expect(await kernel.liveHandleCount()).toBe(1);
    const [before] = sketchesOf(first.finalState);
    const [after] = sketchesOf(second.finalState);
    expect([...(after?.regions.keys() ?? [])]).toEqual(['ab,bc,cd,da']);
    expect(after?.regions.get('ab,bc,cd,da')).not.toBe(before?.regions.get('ab,bc,cd,da,k'));
  });

  it('crossing curves are a warning status of the sketch', async () => {
    const { regenerator } = aSetup();
    const s = aSketch('s1', bowTie());
    const r = result(await regenerator.run({ features: [s], rollbackIndex: 1 }));
    expect(r.statuses.get(s.id)).toEqual({
      kind: 'warning',
      message: 'Sketch curves cross each other; no regions',
    });
  });

  it('invalid sketch data is a validation error of the feature, the builder is not called', async () => {
    const { kernel, regenerator } = aSetup();
    const s = aFeature({
      id: 's1',
      type: SKETCH_FEATURE_TYPE,
      params: { ...sketchSchema.defaults(), entities: [{ kind: 'nope' }] },
    });
    const r = result(await regenerator.run({ features: [s], rollbackIndex: 1 }));
    expect(r.statuses.get(s.id)).toMatchObject({
      kind: 'error',
      error: {
        code: 'INVALID_PARAMS',
        issues: [{ param: 'entities', code: 'sketch.invalidEntity', params: { index: 0 } }],
      },
    });
    expect(kernel.callCount('makeFace')).toBe(0);
  });
});
