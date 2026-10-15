// Ring 1 – immutable domain model: CadDocument, features, schemas, serialization.
// Public API of document (spec 03). Everything else in this folder is internal.

export type { DocumentEvents, DocumentReader, DocumentWriter } from './document';
export type {
  BodyMeta,
  DocumentId,
  DocumentMeta,
  FeatureId,
  FeatureInstance,
  PartStudioData,
} from './model';
export { isBodyColor } from './model';
export type {
  AxisId,
  AxisRef,
  BodyId,
  BodyRef,
  EntityRef,
  PlaneId,
  PlaneRef,
  SketchEntityRef,
  SketchId,
  SketchRegionRef,
  TopoName,
  TopoRef,
} from './refs';
export {
  bodyId,
  originOfBody,
  ownerOf,
  ownerOfArtifact,
  parseAxisId,
  parseBodyId,
  parsePlaneId,
  parseSketchId,
  readRefOf,
  sketchId,
} from './refs';
export { ORIGIN, ORIGIN_AXES, ORIGIN_AXIS_IDS, ORIGIN_PLANE_IDS, ORIGIN_PLANES } from './origin';
export type { OriginAxis, OriginPlane } from './origin';
export { dependenciesOf, dependentsOf, orderViolations, referencesOf } from './references';
export type { OrderViolation } from './references';

export { createDocument } from './cad-document';
export type { CreateDocumentInit } from './cad-document';

export { createFeatureSchemaRegistry, isParamVisible } from './schema';
export type {
  FeatureSchema,
  FeatureSchemaRegistry,
  ParamIssue,
  ParamSchema,
  ParamSchemaOf,
  ParamSpec,
  RefParamKind,
  RefParamSpec,
} from './schema';
export { validateAgainstSchema } from './validate';
export { NO_VARIABLES, evaluateParams } from './evaluate';
export type { Evaluated, ParamVariables } from './evaluate';
export { isJsonObject, isJsonValue } from './json';
export { fromData, migrateFeatureData, toData } from './serialize';
export type { DocumentData, DocumentLoadError, DocumentLoadIssue, FeatureData } from './serialize';
