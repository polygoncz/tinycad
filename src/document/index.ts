// Ring 1 – immutable domain model: CadDocument, features, schemas, serialization.
// Public API of document (spec 03). Everything else in this folder is internal.

export type { DocumentEvents, DocumentReader, DocumentWriter } from './document';
export type {
  BodyMaterial,
  BodyMeta,
  DocumentId,
  DocumentMeta,
  FeatureId,
  FeatureInstance,
  PartStudioData,
} from './model';
export { BODY_MATERIALS, DEFAULT_BODY_MATERIAL, isBodyColor, isBodyMaterial } from './model';
export type {
  AxisId,
  AxisRef,
  BodyId,
  BodyRef,
  PlaneId,
  PlaneRef,
  SketchEntityRef,
  SketchId,
  SketchRegionRef,
  TopoName,
  TopoRef,
} from './refs';
export {
  originOfBody,
  ownerOfArtifact,
  parseAxisId,
  parseBodyId,
  parsePlaneId,
  parseSketchId,
  readPlaneRef,
  readRefOf,
  samePlaneRef,
  sketchId,
} from './refs';
export { ORIGIN, ORIGIN_AXES, ORIGIN_PLANE_IDS, ORIGIN_PLANES } from './origin';
export { dependenciesOf, orderViolations } from './references';
export type { OrderViolation } from './references';

export { createDocument } from './cad-document';

export { createFeatureSchemaRegistry, isParamVisible } from './schema';
export type {
  FeatureSchema,
  FeatureSchemaRegistry,
  ParamIssue,
  ParamSchema,
  ParamSpec,
  RefParamKind,
  RefParamSpec,
} from './schema';
export { validateAgainstSchema } from './validate';
export { NO_VARIABLES, evaluateParams } from './evaluate';
export type { Evaluated } from './evaluate';
export { isJsonObject } from './json';
export { migrateFeatureData } from './serialize';
export type { DocumentLoadError, DocumentLoadIssue, FeatureData } from './serialize';
