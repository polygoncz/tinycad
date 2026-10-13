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
export type { BodyId, BodyRef, EntityRef, SketchRegionRef, TopoName, TopoRef } from './refs';
export { bodyId, originOfBody, ownerOf, parseBodyId } from './refs';
export { dependenciesOf, dependentsOf, orderViolations, referencesOf } from './references';
export type { OrderViolation } from './references';

export { createDocument } from './cad-document';
export type { CreateDocumentInit } from './cad-document';

export { createFeatureSchemaRegistry } from './schema';
export type {
  FeatureSchema,
  FeatureSchemaRegistry,
  ParamIssue,
  ParamSchema,
  ParamSpec,
} from './schema';
export { validateAgainstSchema } from './validate';
export { fromData, migrateFeatureData, toData } from './serialize';
export type { DocumentData, DocumentLoadError, DocumentLoadIssue, FeatureData } from './serialize';
