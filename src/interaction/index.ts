// Ring 2 – presentation models, selection, tools, actions, ViewportPort.
// Public API of interaction (spec 10). Everything else in this folder is internal.

export type {
  HighlightPort,
  HighlightTarget,
  KeyMods,
  OverlayPort,
  OverlayShape,
  OverlayStyle,
  PickFilter,
  PickKind,
  PickResult,
  SketchDrawing,
  SketchDrawingCurve,
  SketchDrawingPoint,
  SketchPort,
  SketchStyle,
  ViewKeyEvent,
  ViewPointerEvent,
  ViewportEvents,
  ViewportPort,
} from './viewport-port';
// Part of the port's vocabulary: render takes BodyId from here, never from document (Q056).
export type { BodyId } from '@/document';
export type { FeatureHealth, RegenBody, RegenSnapshot, RegenStatusPort } from './regen-status-port';
export { bindSelectionHighlight, createSelectionModel, sameSelectionItem } from './selection';
export type { SelectionCommands, SelectionItem, SelectionModel } from './selection';
export { ALL_MODES } from './mode';
export type { Mode } from './mode';
export { createActionRegistry } from './actions';
export type { Action, ActionRegistry, ActionState } from './actions';
export { ACTION_IDS, createBuiltInActions, toolActionId } from './builtin-actions';
export type { ConfirmRequest } from './builtin-actions';
export { createEditLock } from './edit-lock';
export { createToolRegistry, toolModes } from './tools';
export type { Tool, ToolContext, ToolDescriptor, ToolRegistry } from './tools';
export { createToolManager } from './tool-manager';
export type { ToolManager } from './tool-manager';
export { SELECT_TOOL } from './select-tool';
export { createFeatureEditor } from './feature-editor';
export type { EditState, FeatureEditor, FeatureEditSession, FieldState } from './feature-editor';
export { createFeatureTreeModel } from './feature-tree';
export type { FeatureTreeModel, TreeRow, TreeStatus } from './feature-tree';
export { createBrowserModel } from './browser-model';
export type { BrowserBodyRow, BrowserModel } from './browser-model';
export { createSketchEditor } from './sketch-editor';
export type { SketchEditor } from './sketch-editor';
export { EDIT_SKETCH_DRAWING_ID } from './sketch-session';
export type {
  SketchConstraintRow,
  SketchMessageKey,
  SketchSession,
  SketchState,
} from './sketch-session';
export { ORIGIN_POINT_ID, artifactDrawing, planeDrawing, toSketchDrawing } from './sketch-drawing';
export { SKETCH_ACTION_IDS, createSketchActions, sketchConstraintActionId } from './sketch-actions';
export { createSketchTools } from './sketch-tools';
