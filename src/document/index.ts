// Ring 1 – immutable domain model: CadDocument, features, schemas, serialization.
// Public API of document (spec 03). Everything else in this folder is internal.

export type { DocumentEvents, DocumentReader, DocumentWriter } from './document';
export type { DocumentId, DocumentMeta, FeatureId, FeatureInstance, PartStudioData } from './model';
export type { BodyId, BodyRef, EntityRef, SketchRegionRef, TopoName, TopoRef } from './refs';

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
export { fromData, toData } from './serialize';
export type { DocumentData, DocumentLoadError, DocumentLoadIssue } from './serialize';
