// The data entry point of sketcher (M20, D6, ADR 0024): values and pure functions only, no imports
// at all. ui takes its values from here (from index.ts only types), like from
// interaction/constants.ts.

/** Ids of the sketcher actions (sketch-actions.ts); ui and app take them from here, never as literals. */
export const SKETCH_ACTION_IDS = Object.freeze({
  finish: 'sketch.finish',
  cancel: 'sketch.cancel',
  delete: 'sketch.delete',
  construction: 'sketch.construction',
} as const);

/**
 * 'sketch.constraint.<kind>'; also the translation key of its label. The parameter is a plain
 * string, not GeometricConstraintKind: this file may not import sketch (the rule
 * sketcher-constants-only-data), so callers pass a kind of GEOMETRIC_CONSTRAINT_KINDS.
 */
export function sketchConstraintActionId(kind: string): string {
  return `sketch.constraint.${kind}`;
}

/**
 * The action group (ActionState.group) of the geometric constraint actions; the sketcher's
 * toolbar contribution makes its actions the buttons of the toolbar group 'constrain'.
 */
export const SKETCH_CONSTRAINT_ACTION_GROUP = 'sketch.constraint';

/**
 * The action group of the actions that are buttons of the toolbar group 'draw' after its tools
 * (M31: construction); the toolbar contribution places them like the constraint actions.
 */
export const SKETCH_DRAW_ACTION_GROUP = 'sketch.draw';

/** The id of the default tool of the sketch mode (spec 10, "Nástroje a akce skicáře"). */
export const SKETCH_SELECT_TOOL_ID = 'sketch.select';

/**
 * The fonts of a text in the order of the font field of the panel (M37, spec 12 "Text ve skice"):
 * a copy of TEXT_FONTS of sketch, which this file may not import (sketcher-constants-only-data);
 * a test keeps them equal. The label of a font is `t('sketch.font.<id>')`.
 */
export const SKETCH_TEXT_FONTS: readonly ('sans' | 'serif' | 'mono')[] = Object.freeze([
  'sans',
  'serif',
  'mono',
]);
