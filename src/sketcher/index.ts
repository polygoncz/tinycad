// Ring 2 – the sketcher (ADR 0024, spec 12): presentation logic of sketch editing over
// interaction (tools, FeatureEditor, ViewportPort). Public API of sketcher; everything else in
// this folder is internal. interaction never imports it (dependency-cruiser).

export { createSketchEditor } from './sketch-editor';
export type { SketchEditor } from './sketch-editor';
export type {
  SketchConstraintRow,
  SketchMessageKey,
  SketchPlaneField,
  SketchSession,
  SketchState,
} from './sketch-session';
export type { SketchDimensionView } from './sketch-dimensions';
export { artifactDrawing, axisDrawing, planeDrawing } from './sketch-drawing';
export { createSketchActions } from './sketch-actions';
// Also in the data entry point constants.ts, the one ui takes values from (M20, D6).
export { SKETCH_ACTION_IDS, SKETCH_SELECT_TOOL_ID, sketchConstraintActionId } from './constants';
export { createSketchTools } from './sketch-tools';
export { SKETCH_TOOLBAR } from './sketch-toolbar';
