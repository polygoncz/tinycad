// Test-only entry point of regen: a test feature type (schema + spy builder), a ready-made
// Regenerator over the FakeKernel, a BuildContext for builder tests and small helpers for
// feature lists and results. dependency-cruiser allows importing it only from *.test.ts.

import { expect } from 'vitest';
import type { Plane } from '@/core';
import { ORIGIN_PLANES, bodyId, createFeatureSchemaRegistry, sketchId } from '@/document';
import type {
  Evaluated,
  FeatureId,
  FeatureInstance,
  FeatureSchema,
  FeatureSchemaRegistry,
  ParamIssue,
  PartStudioData,
  TopoName,
} from '@/document';
import { aFeature, anEvaluated } from '@/document/testing';
import type { DefaultParams } from '@/document/testing';
import type { ShapeHandle, TopologySummary } from '@/kernel';
import type { SketchEntity } from '@/sketch';
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
import type { Body, NameTable, RegenState, SketchArtifact } from './state';

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
 * Default build of the test feature type: one cube of edge `size` named bodyId(feature.id) and
 * created by the feature (ADR 0015), added to the input state through ctx.kernel.
 */
export const buildCube: FeatureBuilder['build'] = async (
  { feature, params, state },
  { kernel },
) => {
  // The Regenerator evaluated the params with aSchema() before calling the builder.
  const { size } = params as Evaluated<DefaultParams>;
  const { shape } = await kernel.makeBox({ origin: [0, 0, 0], size: [size, size, size] });
  const id = bodyId(feature.id);
  // Frozen like the output of a real builder (boxBuilder); the map is guarded by its type (Q048).
  const body: Body = Object.freeze({
    kind: 'body',
    id,
    origin: feature.id,
    lastModifiedBy: feature.id,
    shape,
    names: EMPTY_NAMES,
  });
  const artifacts = new Map(state.artifacts).set(id, body);
  return { ok: true, state: Object.freeze({ artifacts }), anchors: {} };
};

/**
 * The sketch artifact of the feature `owner`, by default on the origin plane XY and without
 * entities, with the `faces` as regions 'r1', 'r2', … (deeply frozen like the output of a
 * builder). Code that reads bodies must skip it.
 */
export function aSketchArtifact(
  owner: string,
  faces: readonly ShapeHandle[] = [],
  opts: { readonly plane?: Plane; readonly entities?: readonly SketchEntity[] } = {},
): SketchArtifact {
  // Feature ids in tests are plain strings; the id is minted by sketchId like in a builder.
  const feature = owner as FeatureId;
  const xy = ORIGIN_PLANES[0];
  if (xy === undefined) throw new Error('ORIGIN_PLANES has no XY plane');
  return Object.freeze({
    kind: 'sketch',
    id: sketchId(feature),
    owner: feature,
    plane: opts.plane ?? xy.plane,
    entities: Object.freeze([...(opts.entities ?? [])]),
    regions: new Map(faces.map((face, i) => [`r${String(i + 1)}`, face])),
  });
}

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
 * The BuildInput the Regenerator gives a builder for `feature` over `state`: the feature and its
 * params as evaluated (anEvaluated, without validation, so invalid params reach the builder too).
 */
export function aBuildInput<P>(
  feature: FeatureInstance<P>,
  state: RegenState = EMPTY_STATE,
): BuildInput<P> {
  return { feature, params: anEvaluated<P>(feature.params), state };
}

/**
 * The BuildContext the Regenerator gives a builder: the tracked `kernel` (its owned set stays
 * inside), resolveBodies, resolvePlanes, resolveRegions, resolveAxis and resolveTopo (M14) over
 * `state` and a warn whose messages are dropped.
 */
export function aBuildContext(
  kernel: ModelingKernel,
  state: RegenState = EMPTY_STATE,
): BuildContext {
  return createBuildSession({ kernel, owned: new Set<ShapeHandle>(), state }).ctx;
}

/**
 * A name table for tests of builders (M14) from hand-written names: face and edge name →
 * indices. `topology` defaults to just enough faces and edges for every index, none of them
 * planar (surface 'other', edges without faces and vertices); give one for planes of faces.
 * Frozen like a table of propagateNames.
 */
export function aNameTable(
  names: {
    readonly faces?: Readonly<Record<string, readonly number[]>>;
    readonly edges?: Readonly<Record<string, readonly number[]>>;
    readonly topology?: TopologySummary;
  } = {},
): NameTable {
  const faceEntries = entriesOf(names.faces ?? {});
  const edgeEntries = entriesOf(names.edges ?? {});
  const topology = names.topology ?? defaultTopology(faceEntries, edgeEntries);
  const namesAt = (byName: ReadonlyMap<TopoName, readonly number[]>, index: number) =>
    Object.freeze([...byName].filter(([, indices]) => indices.includes(index)).map(([n]) => n));
  return Object.freeze({
    faces: (name: TopoName) => faceEntries.get(name) ?? NO_INDICES,
    edges: (name: TopoName) => edgeEntries.get(name) ?? NO_INDICES,
    nameOfFace: (index: number) => namesAt(faceEntries, index)[0],
    nameOfEdge: (index: number) => namesAt(edgeEntries, index)[0],
    namesOfFace: (index: number) => namesAt(faceEntries, index),
    faceEntries,
    edgeEntries,
    topology,
  });
}

const NO_INDICES: readonly number[] = Object.freeze([]);

/** Name → frozen ascending indices, the names in sorted order. */
function entriesOf(
  record: Readonly<Record<string, readonly number[]>>,
): ReadonlyMap<TopoName, readonly number[]> {
  return new Map(
    Object.keys(record)
      .sort()
      .map((name) => [
        // Test helper: the hand-written strings stand for names minted by propagateNames.
        name as TopoName,
        Object.freeze([...(record[name] ?? [])].sort((a, b) => a - b)),
      ]),
  );
}

/** Faces and edges up to the largest index of the entries, none planar. */
function defaultTopology(
  faces: ReadonlyMap<TopoName, readonly number[]>,
  edges: ReadonlyMap<TopoName, readonly number[]>,
): TopologySummary {
  const countOf = (byName: ReadonlyMap<TopoName, readonly number[]>): number =>
    Math.max(0, ...[...byName.values()].flat().map((i) => i + 1));
  return Object.freeze({
    faces: Object.freeze(
      Array.from({ length: countOf(faces) }, () => Object.freeze({ surface: 'other' as const })),
    ),
    edges: Object.freeze(
      Array.from({ length: countOf(edges) }, () =>
        Object.freeze({ faces: NO_INDICES, vertices: NO_INDICES, midpoint: [0, 0, 0] as const }),
      ),
    ),
    vertexCount: 0,
  });
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
  // Keyed by the feature object the Regenerator passes in BuildInput (it keeps its identity).
  const gates = new Map<BuildInput<unknown>['feature'], Deferred<void>>();
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
