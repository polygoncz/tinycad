import type { RegistryReader } from '@/core';
import { migrateFeatureData } from '@/document';
import type {
  DocumentReader,
  FeatureData,
  FeatureId,
  FeatureInstance,
  FeatureSchema,
} from '@/document';
import type { OpHandler } from '../op-handler';
import { OP_VERSION } from '../operation';
import {
  boolean,
  featureIdText,
  jsonObject,
  nonEmptyString,
  object,
  string,
  validateShape,
  wholeNumber,
} from './shape';
import type {
  FeatureAddOp,
  FeatureMoveOp,
  FeatureRemoveOp,
  FeatureRenameOp,
  FeatureSetParamsOp,
  FeatureSuppressOp,
} from '../operation';

/** invert runs before apply, so a missing feature is a caller error. */
function requireFeature(doc: DocumentReader, id: FeatureId): FeatureInstance {
  const f = doc.feature(id);
  if (f === undefined) throw new Error(`Feature '${id}' does not exist`);
  return f;
}

type Schemas = RegistryReader<FeatureSchema>;

/**
 * Feature data of an operation on the current version of its schema (Q035): the log lives
 * forever, so old entries carry old params. A failed migration throws before any change, so
 * apply leaves the document as it was; replaying a log turns it into an entry error.
 */
function migrated(schemas: Schemas, featureId: FeatureId, data: FeatureData): FeatureData {
  const result = migrateFeatureData(schemas, data);
  if (!result.ok) {
    const { path, message } = result.error;
    throw new Error(`Feature '${featureId}' of type '${data.type}': ${path}: ${message}`);
  }
  return result.value;
}

/** The feature with the type version and params of `data`. */
function withData(f: FeatureInstance, data: FeatureData): FeatureInstance {
  // FeatureInstance.params is Readonly<P> with P = unknown, which rejects a plain unknown.
  return { ...f, typeVersion: data.typeVersion, params: data.params as FeatureInstance['params'] };
}

function addHandler(schemas: Schemas): OpHandler<FeatureAddOp> {
  return {
    type: 'feature.add',
    version: OP_VERSION['feature.add'],
    invert: (_doc, op) => ({
      type: 'feature.remove',
      v: OP_VERSION['feature.remove'],
      featureId: op.feature.id,
    }),
    apply: (doc, op) => {
      const { feature } = op;
      const data = migrated(schemas, feature.id, feature);
      // Current data: the very instance of the operation goes into the document.
      doc.insertFeature(op.index, data === feature ? feature : withData(feature, data));
    },
    validate: validateShape({
      feature: object({
        id: featureIdText,
        type: nonEmptyString,
        typeVersion: wholeNumber(1),
        name: string,
        suppressed: boolean,
        params: jsonObject,
      }),
      index: wholeNumber(0),
    }),
  };
}

const remove: OpHandler<FeatureRemoveOp> = {
  type: 'feature.remove',
  version: OP_VERSION['feature.remove'],
  invert: (doc, op) => {
    const feature = requireFeature(doc, op.featureId);
    return {
      type: 'feature.add',
      v: OP_VERSION['feature.add'],
      feature,
      index: doc.indexOf(op.featureId),
    };
  },
  apply: (doc, op) => {
    doc.removeFeature(op.featureId);
  },
  validate: validateShape({ featureId: nonEmptyString }),
};

function setParamsHandler(schemas: Schemas): OpHandler<FeatureSetParamsOp> {
  return {
    type: 'feature.setParams',
    version: OP_VERSION['feature.setParams'],
    invert: (doc, op) => {
      const f = requireFeature(doc, op.featureId);
      return {
        type: 'feature.setParams',
        v: OP_VERSION['feature.setParams'],
        featureId: op.featureId,
        typeVersion: f.typeVersion,
        params: f.params,
      };
    },
    apply: (doc, op) => {
      const f = requireFeature(doc, op.featureId);
      // The type comes from the document: the operation only knows the feature by its id.
      const data = { type: f.type, typeVersion: op.typeVersion, params: op.params };
      doc.replaceFeature(withData(f, migrated(schemas, f.id, data)));
    },
    // Same feature: the later params win; the inverse of the first op still restores the start.
    merge: (prev, next) => (prev.featureId === next.featureId ? next : null),
    validate: validateShape({
      featureId: nonEmptyString,
      typeVersion: wholeNumber(1),
      params: jsonObject,
    }),
  };
}

const rename: OpHandler<FeatureRenameOp> = {
  type: 'feature.rename',
  version: OP_VERSION['feature.rename'],
  invert: (doc, op) => ({
    type: 'feature.rename',
    v: OP_VERSION['feature.rename'],
    featureId: op.featureId,
    name: requireFeature(doc, op.featureId).name,
  }),
  apply: (doc, op) => {
    doc.replaceFeature({ ...requireFeature(doc, op.featureId), name: op.name });
  },
  validate: validateShape({ featureId: nonEmptyString, name: string }),
};

const suppress: OpHandler<FeatureSuppressOp> = {
  type: 'feature.suppress',
  version: OP_VERSION['feature.suppress'],
  invert: (doc, op) => ({
    type: 'feature.suppress',
    v: OP_VERSION['feature.suppress'],
    featureId: op.featureId,
    suppressed: requireFeature(doc, op.featureId).suppressed,
  }),
  apply: (doc, op) => {
    doc.replaceFeature({ ...requireFeature(doc, op.featureId), suppressed: op.suppressed });
  },
  validate: validateShape({ featureId: nonEmptyString, suppressed: boolean }),
};

const move: OpHandler<FeatureMoveOp> = {
  type: 'feature.move',
  version: OP_VERSION['feature.move'],
  invert: (doc, op) => {
    requireFeature(doc, op.featureId);
    return {
      type: 'feature.move',
      v: OP_VERSION['feature.move'],
      featureId: op.featureId,
      toIndex: doc.indexOf(op.featureId),
    };
  },
  apply: (doc, op) => {
    doc.moveFeature(op.featureId, op.toIndex);
  },
  validate: validateShape({ featureId: nonEmptyString, toIndex: wholeNumber(0) }),
};

/**
 * The built-in feature.* handlers. feature.add and feature.setParams migrate the feature data
 * they carry with `schemas` when applied (Q035).
 */
export function createFeatureHandlers(schemas: Schemas): readonly OpHandler[] {
  // Method-style members make OpHandler<O> assignable to OpHandler<Operation>; the dispatcher
  // looks handlers up by op.type, so each one only ever sees its own operation.
  return [addHandler(schemas), remove, setParamsHandler(schemas), rename, suppress, move];
}
