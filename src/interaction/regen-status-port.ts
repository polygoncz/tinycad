// The regeneration status port (spec 10, "Port stavu regenerace"): interaction must not know
// regen, yet the feature tree shows regeneration errors and the selection of subshapes is
// cleared after a regeneration. So interaction defines its own port and app feeds it from
// RegenState (Q063, Q064). Suppression and the rollback bar are not here: interaction reads
// them from the document directly, so they show at once, not after a regeneration.

import type { Observable } from '@/core';
import type { BodyId, FeatureId, ParamIssue, SketchId } from '@/document';

export type FeatureHealth =
  | { readonly kind: 'ok' }
  | { readonly kind: 'warning'; readonly message: string }
  | {
      readonly kind: 'error';
      readonly message: string;
      /** Invalid params (INVALID_PARAMS); ui translates these, not the message (ADR 0014). */
      readonly issues?: readonly ParamIssue[];
    };

/** A body of the last regeneration and the feature that made it. */
export interface RegenBody {
  readonly body: BodyId;
  readonly feature: FeatureId;
}

/** A sketch of the last regeneration and the feature that made it (M12). */
export interface RegenSketch {
  readonly sketch: SketchId;
  readonly feature: FeatureId;
  /** Names of the regions in the order of the artifact (M13, the browser). */
  readonly regions: readonly string[];
}

export interface RegenSnapshot {
  /** Grows by 1 with each finished regeneration; 0 = none yet. */
  readonly generation: number;
  /** Features the last regeneration evaluated (not suppressed, not after the bar). */
  readonly health: ReadonlyMap<FeatureId, FeatureHealth>;
  /** Bodies of the final state of the last regeneration, in its order (the browser rows). */
  readonly bodies: readonly RegenBody[];
  /** Sketches of the final state of the last regeneration, in its order (the browser, M12). */
  readonly sketches: readonly RegenSketch[];
}

export interface RegenStatusPort {
  readonly state: Observable<RegenSnapshot>;
}
