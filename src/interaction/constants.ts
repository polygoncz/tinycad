// The data entry point of interaction (M20, D6): values and pure functions only, no imports
// beyond core and the data file mode.ts. ui takes its values from here (from index.ts only types);
// render gets them from app when the viewport is created, since it may take only types from
// interaction.

import type { Mode } from './mode';

/** Ids of the built-in actions (builtin-actions.ts); ui takes them from here, never as literals. */
export const ACTION_IDS = Object.freeze({
  undo: 'undo',
  redo: 'redo',
  fitAll: 'view.fitAll',
  viewFront: 'view.front',
  viewBack: 'view.back',
  viewRight: 'view.right',
  viewLeft: 'view.left',
  viewTop: 'view.top',
  viewBottom: 'view.bottom',
  viewIso: 'view.iso',
  featureEdit: 'feature.edit',
  featureRename: 'feature.rename',
  featureSuppress: 'feature.suppress',
  featureDelete: 'feature.delete',
  rollHere: 'timeline.rollHere',
  toStart: 'timeline.toStart',
  stepBack: 'timeline.stepBack',
  stepForward: 'timeline.stepForward',
  toEnd: 'timeline.toEnd',
} as const);

/** The action that activates a tool with a shortcut (ui must not build it itself, spec 10). */
export function toolActionId(toolId: string): string {
  return `tool.${toolId}`;
}

const MODEL_ONLY: readonly Mode[] = Object.freeze(['model']);

/**
 * The modes of a tool: its own, or ['model'] when it does not say (spec 10, "Režim"). Takes any
 * ToolDescriptor; the parameter names only `modes`, so this file needs no import of tools.ts.
 */
export function toolModes(tool: { readonly modes?: readonly Mode[] }): readonly Mode[] {
  return tool.modes ?? MODEL_ONLY;
}

/** A left up farther than this from its down is a drag, not a click. */
export const CLICK_TOLERANCE_PX = 4;

/** Ids of the File actions (file-actions.ts); ui takes them from here, never as literals. */
export const FILE_ACTION_IDS = Object.freeze({
  exportStep: 'file.exportStep',
  exportDocument: 'file.exportDocument',
} as const);

/** Sizes of the glyphs of manipulator handles in CSS px (spec 09, "Vzhled od M19"). */
export interface ManipulatorGlyphs {
  /** Where the shaft of an arrow starts, from its position (a gap for the centre point). */
  readonly arrowStartPx: number;
  /** Where the shaft of an arrow ends and its cone starts, from its position. */
  readonly arrowShaftPx: number;
  /** Length and radius of the cone at the tip of an arrow. */
  readonly arrowConePx: number;
  readonly arrowConeRadiusPx: number;
  /** The tip of an arrow from its position: arrowShaftPx + arrowConePx. */
  readonly arrowTipPx: number;
  /** Radius of a ring and a quarter. */
  readonly ringPx: number;
  /** A square spans from squareNearPx to squareFarPx along u and along v from its origin. */
  readonly squareNearPx: number;
  readonly squareFarPx: number;
  /** Radius of the disc of a point handle. */
  readonly pointPx: number;
}

const ARROW_SHAFT_PX = 80;
const ARROW_CONE_PX = 18;

export const MANIPULATOR_GLYPHS: ManipulatorGlyphs = Object.freeze({
  arrowStartPx: 14,
  arrowShaftPx: ARROW_SHAFT_PX,
  arrowConePx: ARROW_CONE_PX,
  arrowConeRadiusPx: 6,
  arrowTipPx: ARROW_SHAFT_PX + ARROW_CONE_PX,
  ringPx: 72,
  squareNearPx: 26,
  squareFarPx: 46,
  pointPx: 9,
});

/**
 * When a glyph is seen so badly that it is neither drawn nor picked (spec 09). Each limit is
 * stricter than the limit of its drag in manipulator-drag.ts (PARALLEL_LIMIT, EDGE_ON_LIMIT), so
 * a glyph disappears before it cannot be dragged.
 */
export interface HandleVisibility {
  /** An arrow with |direction · view direction| above this points at the viewer. */
  readonly arrowHideCos: number;
  /** A ring or quarter with |axis · view direction| below this is seen edge-on. */
  readonly ringHideCos: number;
  /** A square with |(u × v) · view direction| below this is seen edge-on. */
  readonly squareHideCos: number;
}

export const HANDLE_VISIBILITY: HandleVisibility = Object.freeze({
  arrowHideCos: 0.98,
  ringHideCos: 0.05,
  squareHideCos: 0.05,
});
