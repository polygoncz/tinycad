// Test-only entry point of regen: a test feature type (schema + spy builder), a ready-made
// Regenerator over the FakeKernel, a BuildContext for builder tests and small helpers for
// feature lists and results. dependency-cruiser allows importing it only from *.test.ts.

import { expect } from 'vitest';
import { createFeatureSchemaRegistry } from '@/document';
import type {
  BodyId,
  FeatureId,
  FeatureInstance,
  FeatureSchema,
  FeatureSchemaRegistry,
  ParamIssue,
  PartStudioData,
} from '@/document';
import { aFeature } from '@/document/testing';
import type { DefaultParams } from '@/document/testing';
import type { ShapeHandle } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import type { FakeKernel } from '@/kernel/testing';
import { createBuildSession } from './build-context';
import { createBuilderRegistry } from './builder';
import type {
  BuildContext,
  BuilderRegistry,
  BuildInput,
  FeatureBuilder,
  ModelingKernel,
} from './builder';
import { createRegenerator } from './regenerator';
import type { RegenResult, Regenerator } from './regenerator';
import { EMPTY_NAMES, EMPTY_STATE } from './state';
import type { Body, RegenState } from './state';

/** Body id the default test builder gives the body of a feature. */
export function bodyIdOf(feature: FeatureId): BodyId {
  // Same naming as real builders (spec 07); test-only, so the cast is the trusted place.
  return `${feature}/body` as BodyId;
}

/** Validation of the default test schema: params of aFeature() with `size` > 0. */
export function validateSize(params: unknown): readonly ParamIssue[] {
  const size: unknown =
    typeof params === 'object' && params !== null ? Reflect.get(params, 'size') : undefined;
  return typeof size === 'number' && size > 0
    ? []
    : [{ param: 'size', code: 'param.atOrBelowMin', params: { min: 0 } }];
}

/** A schema of `type`, by default for the params of aFeature() (DefaultParams). */
export function aSchema(
  type = 'box',
  validate: (params: unknown) => readonly ParamIssue[] = validateSize,
): FeatureSchema {
  return {
    type,
    version: 1,
    label: type,
    params: { size: { kind: 'length', label: 'Size', default: 1, min: 0, exclusiveMin: true } },
    defaults: (): DefaultParams => ({ size: 1 }),
    validate,
  };
}

/**
 * Default build of the test feature type: one cube of edge `size` named bodyIdOf(feature.id),
 * added to the input state through ctx.kernel.
 */
export const buildCube: FeatureBuilder['build'] = async ({ feature, state }, { kernel }) => {
  // The Regenerator validated the params with aSchema() before calling the builder.
  const { size } = feature.params as DefaultParams;
  const { shape } = await kernel.makeBox({ origin: [0, 0, 0], size: [size, size, size] });
  const id = bodyIdOf(feature.id);
  // Frozen like the output of a real builder (boxBuilder); the map is guarded by its type (Q048).
  const body: Body = Object.freeze({ id, shape, createdBy: feature.id, names: EMPTY_NAMES });
  const bodies = new Map(state.bodies).set(id, body);
  return { ok: true, state: Object.freeze({ bodies }) };
};

/** Features 'f1'..'fn' of the default test type, each a new object. */
export function features(n: number): FeatureInstance<DefaultParams>[] {
  return Array.from({ length: n }, (_, i) => aFeature({ id: `f${String(i + 1)}` }));
}

/** A copy of the feature with a new size (new identity, same id). */
export function resized(
  feature: FeatureInstance<DefaultParams>,
  size: number,
): FeatureInstance<DefaultParams> {
  return { ...feature, params: { size } };
}

/** The result of a run that must not be superseded; fails the test otherwise. */
export function result(r: RegenResult | 'superseded'): RegenResult {
  if (r === 'superseded') expect.fail('Unexpected superseded run');
  return r;
}

/**
 * The BuildContext the Regenerator gives a builder: the tracked `kernel` (its owned set stays
 * inside), resolveBodies over `state` and a warn whose messages are dropped.
 */
export function aBuildContext(
  kernel: ModelingKernel,
  state: RegenState = EMPTY_STATE,
): BuildContext {
  return createBuildSession({ kernel, owned: new Set<ShapeHandle>(), state }).ctx;
}

/** A builder that records every call before delegating to `build`. */
export interface SpyBuilder extends FeatureBuilder {
  /** Inputs of all calls, in call order. */
  readonly calls: readonly BuildInput<unknown>[];
  /** Ids of the built features, in call order. */
  builtIds(): FeatureId[];
}

export function aSpyBuilder(type = 'box', build: FeatureBuilder['build'] = buildCube): SpyBuilder {
  const calls: BuildInput<unknown>[] = [];
  return {
    type,
    calls,
    builtIds: () => calls.map((c) => c.feature.id),
    build(input, ctx) {
      calls.push(input);
      return build(input, ctx);
    },
  };
}

/** A part studio of the features; by default everything is in front of the rollback bar. */
export function aStudio(
  features: readonly FeatureInstance[],
  rollbackIndex = features.length,
): PartStudioData {
  return { features, rollbackIndex };
}

export interface RegenSetup {
  readonly kernel: FakeKernel;
  readonly schemas: FeatureSchemaRegistry;
  readonly builders: BuilderRegistry;
  /** Builder of type 'box', registered together with aSchema('box'). */
  readonly box: SpyBuilder;
  readonly regenerator: Regenerator;
}

/**
 * A Regenerator over a fresh FakeKernel with the test type 'box' (aSchema + aSpyBuilder).
 * `build` replaces the build of 'box' (default buildCube); `now` is the clock (default a fake
 * clock that stands at 0).
 */
export function aRegenSetup(
  opts: { now?: () => number; build?: FeatureBuilder['build'] } = {},
): RegenSetup {
  const kernel = createFakeKernel();
  const schemas = createFeatureSchemaRegistry();
  const builders = createBuilderRegistry();
  const box = aSpyBuilder('box', opts.build);
  schemas.register(aSchema());
  builders.register(box);
  const regenerator = createRegenerator({
    kernel,
    builders,
    schemas,
    now: opts.now ?? stoppedClock,
  });
  return { kernel, schemas, builders, box, regenerator };
}

/** A fake clock that never moves: durationMs is 0. */
export function stoppedClock(): number {
  return 0;
}

/** A promise settled by hand, for builders that wait until the test lets them go on. */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * A build that, for the features held by `hold`, waits for their deferred before building with
 * `build`. Features are matched by identity, like the cache.
 */
export function aGatedBuild(build: FeatureBuilder['build'] = buildCube): {
  readonly build: FeatureBuilder['build'];
  /** Makes the build of `feature` wait until the returned deferred resolves. */
  hold(feature: FeatureInstance): Deferred<void>;
} {
  const gates = new Map<FeatureInstance, Deferred<void>>();
  return {
    build: async (input, ctx) => {
      await gates.get(input.feature)?.promise;
      return build(input, ctx);
    },
    hold(feature) {
      const gate = deferred();
      gates.set(feature, gate);
      return gate;
    },
  };
}
