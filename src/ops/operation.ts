import type { FeatureId, FeatureInstance } from '@/document';

// Operations are plain JSON data (spec 04): payload sits directly on the object,
// there is no constructor function. The log lives forever, so shapes stay small.

/**
 * Current schema version of every operation type, in one place: handlers (their `version` and
 * the `v` of the inverses they create), applyOperation and upcast all use it (spec 04).
 * One object keyed by type rather than loose constants, so a lookup by type stays typo-safe.
 * Exported from index.ts for creators of operations outside ops (spec 04).
 */
export const OP_VERSION = {
  'feature.add': 1,
  'feature.remove': 1,
  'feature.setParams': 1,
  'feature.rename': 1,
  'feature.suppress': 1,
  'feature.move': 1,
  'studio.setRollback': 1,
  batch: 1,
} as const;

export interface Operation {
  readonly type: string;
  /** Schema version of this operation, integer >= 1. */
  readonly v: number;
}

export interface FeatureAddOp extends Operation {
  readonly type: 'feature.add';
  readonly feature: FeatureInstance;
  readonly index: number;
}

export interface FeatureRemoveOp extends Operation {
  readonly type: 'feature.remove';
  readonly featureId: FeatureId;
}

export interface FeatureSetParamsOp extends Operation {
  readonly type: 'feature.setParams';
  readonly featureId: FeatureId;
  /** The whole new params, not a patch. */
  readonly params: unknown;
}

export interface FeatureRenameOp extends Operation {
  readonly type: 'feature.rename';
  readonly featureId: FeatureId;
  readonly name: string;
}

export interface FeatureSuppressOp extends Operation {
  readonly type: 'feature.suppress';
  readonly featureId: FeatureId;
  readonly suppressed: boolean;
}

export interface FeatureMoveOp extends Operation {
  readonly type: 'feature.move';
  readonly featureId: FeatureId;
  readonly toIndex: number;
}

export interface StudioSetRollbackOp extends Operation {
  readonly type: 'studio.setRollback';
  readonly index: number;
}

/** Structural operation without a handler in the registry (Q031). */
export interface BatchOp extends Operation {
  readonly type: 'batch';
  readonly ops: readonly Operation[];
}
