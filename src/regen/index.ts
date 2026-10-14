// Ring 1 – Regenerator, FeatureBuilder, regeneration state and cache.
// Public API of regen (spec 07). Everything else in this folder is internal.

export { EMPTY_NAMES, EMPTY_STATE, bodiesOf, planesOf, sketchesOf } from './state';
export type {
  Artifact,
  ArtifactId,
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
} from './builder';
export { createRegenerator } from './regenerator';
export type { RegenEvents, RegenResult, Regenerator } from './regenerator';
