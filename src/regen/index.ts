// Ring 1 – Regenerator, FeatureBuilder, regeneration state and cache.
// Public API of regen (spec 07). Everything else in this folder is internal.

export { EMPTY_NAMES, EMPTY_STATE, axesOf, bodiesOf, planesOf, sketchesOf } from './state';
export type {
  Artifact,
  ArtifactId,
  AxisArtifact,
  Body,
  FeatureError,
  FeatureStatus,
  NameTable,
  PlaneArtifact,
  RegenState,
  SketchArtifact,
} from './state';
export { createBuilderRegistry, unresolvedReference } from './builder';
export type {
  BuildContext,
  BuildInput,
  BuilderRegistry,
  BuildOutput,
  FeatureBuilder,
  ModelingKernel,
  RefError,
  ResolvedAxis,
  ResolvedRegion,
} from './builder';
export { applyBodyOperation } from './body-operation';
export type { BodyOperation } from './body-operation';
export { createRegenerator } from './regenerator';
export type { RegenEvents, RegenResult, Regenerator } from './regenerator';
