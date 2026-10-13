import type { BodyId, FeatureId, FeatureInstance } from '@/document';

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
  // 2 since M10.1: carries typeVersion (Q035).
  'feature.setParams': 2,
  'feature.rename': 1,
  'feature.suppress': 1,
  'feature.move': 1,
  'studio.setRollback': 1,
  'body.rename': 1,
  'body.setVisible': 1,
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
  /** Version of the feature schema the params were written with; apply migrates older ones (Q035). */
  readonly typeVersion: number;
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

/** Name of a body in the document's body metadata (M11, spec 03). */
export interface BodyRenameOp extends Operation {
  readonly type: 'body.rename';
  readonly body: BodyId;
  /** '' removes the name. */
  readonly name: string;
}

/** Visibility of a body in the document's body metadata (M11, spec 03). */
export interface BodySetVisibleOp extends Operation {
  readonly type: 'body.setVisible';
  readonly body: BodyId;
  readonly visible: boolean;
}

/** Structural operation without a handler in the registry (Q031). */
export interface BatchOp extends Operation {
  readonly type: 'batch';
  readonly ops: readonly Operation[];
}
