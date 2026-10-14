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
  PlaneArtifact,
  RegenState,
  SketchArtifact,
} from './state';
export { nameShape, propagateNames } from './names';
export { planeOfRef, sketchPlaneOfFace } from './face-plane';
export type { NameTable } from './names';
export { createBuilderRegistry, unresolvedReference } from './builder';
export type {
  Anchor,
  BuildContext,
  BuildInput,
  BuilderRegistry,
  BuildOutput,
  FeatureAnchors,
  FeatureBuilder,
  ModelingKernel,
  RefError,
  ResolvedAxis,
  ResolvedPlane,
  ResolvedRegion,
  ResolvedTopo,
} from './builder';
export { applyBodyOperation } from './body-operation';
export { modifyBody, replaceBodies } from './body-change';
export type { BodyOperation } from './body-operation';
export { createRegenerator } from './regenerator';
export type { RegenEvents, RegenResult, Regenerator } from './regenerator';
