import { describe, expect, it } from 'vitest';
import { createFeatureSchemaRegistry } from '@/document';
import type { BodyId, FeatureId, FeatureInstance } from '@/document';
import { aFeature } from '@/document/testing';
import { createFakeKernel } from '@/kernel/testing';
import { registerPlugin } from '@/plugin-api';
import { EMPTY_NAMES, EMPTY_STATE, createBuilderRegistry, createRegenerator } from '@/regen';
import type { Body, RegenState } from '@/regen';
import { aBuildContext, stoppedClock } from '@/regen/testing';
import { boxBuilder } from './builder';
import { boxSchema } from './schema';
import type { BoxParams } from './schema';
import * as box from '.';

function aBox(id: string, params: Partial<BoxParams> = {}): FeatureInstance<BoxParams> {
  return aFeature({ id, type: 'box', params: { ...boxSchema.defaults(), ...params } });
}

async function build(
  feature: FeatureInstance<BoxParams>,
  state: RegenState = EMPTY_STATE,
  kernel = createFakeKernel(),
): Promise<RegenState> {
  const output = await boxBuilder.build({ feature, state }, aBuildContext(kernel, state));
  if (!output.ok) expect.fail(`Unexpected build error: ${output.error.message}`);
  return output.state;
}

describe('box public API', () => {
  it('exports exactly boxPlugin', () => {
    expect(Object.keys(box)).toEqual(['boxPlugin']);
  });

  it('boxPlugin joins the schema and the builder of type box', () => {
    expect(box.boxPlugin.schema).toBe(boxSchema);
    expect(box.boxPlugin.builder).toBe(boxBuilder);
    expect(boxSchema.type).toBe('box');
    expect(boxBuilder.type).toBe('box');
  });
});

describe('boxSchema', () => {
  it('is version 1 of type box', () => {
    expect(boxSchema).toMatchObject({ type: 'box', version: 1, label: 'Box' });
  });

  it('is frozen deeply, param specs and the origin default included', () => {
    expect(Object.isFrozen(boxSchema)).toBe(true);
    expect(Object.isFrozen(boxSchema.params)).toBe(true);
    for (const [key, spec] of Object.entries(boxSchema.params)) {
      expect(Object.isFrozen(spec), key).toBe(true);
    }
    const origin = boxSchema.params['origin'];
    if (origin?.kind !== 'point') expect.fail('origin is not a point param');
    expect(Object.isFrozen(origin.default)).toBe(true);
  });

  it('defaults pass validation', () => {
    expect(boxSchema.validate(boxSchema.defaults())).toEqual([]);
  });

  it('defaults returns a new object every call', () => {
    const a = boxSchema.defaults();
    const b = boxSchema.defaults();
    expect(a).not.toBe(b);
    expect(a.origin).not.toBe(b.origin);
    expect(a).toEqual(b);
  });

  it.each(['width', 'depth', 'height'] as const)('rejects a zero, negative or NaN %s', (key) => {
    for (const value of [0, -0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const issues = boxSchema.validate({ ...boxSchema.defaults(), [key]: value });
      expect(issues, `${key} = ${String(value)}`).toHaveLength(1);
      expect(issues[0]?.param).toBe(key);
    }
  });

  it('accepts a small positive size', () => {
    expect(boxSchema.validate({ ...boxSchema.defaults(), width: 1e-9 })).toEqual([]);
  });

  it.each([[[0, 0]], [[0, 0, 0, 0]], [[0, 0, Number.NaN]], ['0,0,0'], [undefined]])(
    'rejects origin %j',
    (origin) => {
      const issues = boxSchema.validate({ ...boxSchema.defaults(), origin });
      expect(issues.map((i) => i.param)).toEqual(['origin']);
    },
  );

  it('rejects params that are not an object, missing and unexpected params', () => {
    expect(boxSchema.validate(null)).not.toEqual([]);
    const withoutWidth = Object.fromEntries(
      Object.entries(boxSchema.defaults()).filter(([key]) => key !== 'width'),
    );
    expect(boxSchema.validate(withoutWidth).map((i) => i.param)).toEqual(['width']);
    expect(boxSchema.validate({ ...boxSchema.defaults(), size: 1 }).map((i) => i.param)).toEqual([
      'size',
    ]);
  });
});

describe('boxBuilder', () => {
  it('adds one body named <featureId>/body, created by the feature', async () => {
    const state = await build(aBox('b1'));
    expect([...state.bodies.keys()]).toEqual(['b1/body']);
    const body = state.bodies.get('b1/body' as BodyId);
    expect(body).toMatchObject({ id: 'b1/body', createdBy: 'b1', names: EMPTY_NAMES });
  });

  it('makes a box spanning origin + size', async () => {
    const kernel = createFakeKernel();
    const feature = aBox('b1', { origin: [1, 2, 3], width: 4, depth: 5, height: 6 });
    const state = await build(feature, EMPTY_STATE, kernel);
    const body = state.bodies.get('b1/body' as BodyId);
    if (body === undefined) expect.fail('No body');
    expect(await kernel.boundingBox(body.shape)).toEqual({ min: [1, 2, 3], max: [5, 7, 9] });
  });

  it('keeps the bodies of the input state and does not change it', async () => {
    const kernel = createFakeKernel();
    const first = await build(aBox('b1'), EMPTY_STATE, kernel);
    const firstBody = first.bodies.get('b1/body' as BodyId);
    const second = await build(aBox('b2'), first, kernel);
    expect([...first.bodies.keys()]).toEqual(['b1/body']);
    expect([...second.bodies.keys()]).toEqual(['b1/body', 'b2/body']);
    expect(second.bodies.get('b1/body' as BodyId)).toBe(firstBody);
    expect(EMPTY_STATE.bodies.size).toBe(0);
  });

  it('freezes the output state and the new body', async () => {
    const state = await build(aBox('b1'));
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.bodies.get('b1/body' as BodyId))).toBe(true);
  });
});

describe('box plugin in the Regenerator', () => {
  it('regenerates a studio with two boxes into two bodies', async () => {
    const kernel = createFakeKernel();
    const schemas = createFeatureSchemaRegistry();
    const builders = createBuilderRegistry();
    registerPlugin(box.boxPlugin, { schemas, builders });
    const regenerator = createRegenerator({ kernel, schemas, builders, now: stoppedClock });
    const features = [aBox('b1'), aBox('b2', { origin: [20, 0, 0] })];

    const result = await regenerator.run({ features, rollbackIndex: features.length });

    if (result === 'superseded') expect.fail('Unexpected superseded run');
    const bodies: Body[] = [...result.finalState.bodies.values()];
    expect(bodies.map((b) => [b.id, b.createdBy])).toEqual([
      ['b1/body', 'b1'],
      ['b2/body', 'b2'],
    ]);
    expect([...result.statuses]).toEqual([
      ['b1' as FeatureId, { kind: 'ok' }],
      ['b2' as FeatureId, { kind: 'ok' }],
    ]);
    expect(await kernel.liveHandleCount()).toBe(2);
  });
});
