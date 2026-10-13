import type { DocumentReader, FeatureId, FeatureInstance } from '@/document';
import type { OpHandler } from '../op-handler';
import { OP_VERSION } from '../operation';
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

const add: OpHandler<FeatureAddOp> = {
  type: 'feature.add',
  version: OP_VERSION['feature.add'],
  invert: (_doc, op) => ({
    type: 'feature.remove',
    v: OP_VERSION['feature.remove'],
    featureId: op.feature.id,
  }),
  apply: (doc, op) => {
    doc.insertFeature(op.index, op.feature);
  },
};

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
};

const setParams: OpHandler<FeatureSetParamsOp> = {
  type: 'feature.setParams',
  version: OP_VERSION['feature.setParams'],
  invert: (doc, op) => ({
    type: 'feature.setParams',
    v: OP_VERSION['feature.setParams'],
    featureId: op.featureId,
    params: requireFeature(doc, op.featureId).params,
  }),
  apply: (doc, op) => {
    doc.replaceFeature({
      ...requireFeature(doc, op.featureId),
      // FeatureInstance.params is Readonly<P> with P = unknown, which rejects a plain unknown.
      params: op.params as FeatureInstance['params'],
    });
  },
  // Same feature: the later params win; the inverse of the first op still restores the start.
  merge: (prev, next) => (prev.featureId === next.featureId ? next : null),
};

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
};

// Method-style members make OpHandler<O> assignable to OpHandler<Operation>; the dispatcher
// looks handlers up by op.type, so each one only ever sees its own operation.
export const featureHandlers: readonly OpHandler[] = [
  add,
  remove,
  setParams,
  rename,
  suppress,
  move,
];
