import type { BodyId, BodyMaterial, FeatureId, FeatureInstance } from '@/document';

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
  'body.setColor': 1,
  'body.setMaterial': 1,
  'document.rename': 1,
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

/** Color of a body in the document's body metadata (M15, spec 03). */
export interface BodySetColorOp extends Operation {
  readonly type: 'body.setColor';
  readonly body: BodyId;
  /** '#rrggbb' in lower case (isBodyColor); null = the default color. */
  readonly color: string | null;
}

/** Material preset of a body in the document's body metadata (M24, spec 03, ADR 0027). */
export interface BodySetMaterialOp extends Operation {
  readonly type: 'body.setMaterial';
  readonly body: BodyId;
  /** isBodyMaterial; DEFAULT_BODY_MATERIAL ('plastic') is the default, there is no null. */
  readonly material: BodyMaterial;
}

/**
 * Name of the document (M19.2, D5). Metadata outside undo: the UndoManager of the server
 * (server/src/ops/undo.cpp) skips its 'do' entries; its log carries it like any other change.
 */
export interface DocumentRenameOp extends Operation {
  readonly type: 'document.rename';
  /** Trimmed and not empty. */
  readonly name: string;
}

/**
 * The operation renames the document (M19.2, D5): the test of the rule "the name is outside
 * undo" of the client (the in-memory undo of ops/testing.ts); the server has its own
 * (server/src/ops). Checks the name too, so it can be given any operation.
 */
export function isDocumentRename(op: Operation): op is DocumentRenameOp {
  return op.type === 'document.rename' && 'name' in op && typeof op.name === 'string';
}

/** Structural operation without a handler in the registry (Q031). */
export interface BatchOp extends Operation {
  readonly type: 'batch';
  readonly ops: readonly Operation[];
}
