// Ring 1 – Regenerator, FeatureBuilder, regeneration state and cache.
// Public API of regen (spec 07). Everything else in this folder is internal.

export { EMPTY_NAMES, EMPTY_STATE } from './state';
export type { Body, FeatureError, FeatureStatus, NameTable, RegenState } from './state';
export { createBuilderRegistry } from './builder';
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
