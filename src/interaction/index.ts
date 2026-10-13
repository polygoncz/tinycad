// Ring 2 – presentation models, selection, tools, actions, ViewportPort.
// Public API of interaction (spec 10). Everything else in this folder is internal.

export type {
  HighlightPort,
  HighlightTarget,
  KeyMods,
  OverlayPort,
  OverlayShape,
  OverlayStyle,
  PickResult,
  ViewKeyEvent,
  ViewPointerEvent,
  ViewportEvents,
  ViewportPort,
} from './viewport-port';
// Part of the port's vocabulary: render takes BodyId from here, never from document (Q056).
export type { BodyId } from '@/document';
export type { FeatureHealth, RegenSnapshot, RegenStatusPort } from './regen-status-port';
export { bindSelectionHighlight, createSelectionModel, sameSelectionItem } from './selection';
export type { SelectionCommands, SelectionItem, SelectionModel } from './selection';
export { createActionRegistry } from './actions';
export type { Action, ActionRegistry, ActionState } from './actions';
export { createToolRegistry } from './tools';
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
