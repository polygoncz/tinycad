// Tools (spec 10, "Nástroje"): a tool turns viewport events into operations. The
// descriptor carries the identity and creates a fresh tool on every activation.

import { createRegistry } from '@/core';
import type { IdGenerator, Registry } from '@/core';
import type { DocumentReader } from '@/document';
import type { FeatureEditor } from './feature-dialog/feature-editor';
import type { Mode } from './mode';
import type { SelectionCommands } from './selection';
import type { HighlightPort, ViewKeyEvent, ViewPointerEvent, ViewportPort } from './viewport-port';

export interface Tool {
  activate(ctx: ToolContext): void;
  deactivate(): void;
  onPointer?(e: ViewPointerEvent): void;
  /** true = the event was handled. */
  onKey?(e: ViewKeyEvent): boolean;
}

/**
 * The viewport as a tool sees it (ADR 0011): picking, rays, the overlay and the hover. The
 * selection highlight belongs to bindSelectionHighlight, events come through Tool, manipulators
 * and sketch drawings are not the business of a tool.
 */
export interface ToolViewport extends Pick<ViewportPort, 'pick' | 'screenToRay' | 'overlay'> {
  readonly highlight: Pick<HighlightPort, 'setHover'>;
}

/** The FeatureEditor as a tool uses it: it opens the dialog of a new feature. */
export type ToolFeatures = Pick<FeatureEditor, 'create' | 'current'>;

export interface ToolContext {
  readonly viewport: ToolViewport;
  readonly selection: SelectionCommands;
  readonly doc: DocumentReader;
  readonly ids: IdGenerator;
  /**
   * Creating a feature through the dialog. No operations of its own: a tool changes the document
   * only through FeatureEditor or SketchEditor (Q069).
   */
  readonly features: ToolFeatures;
  /** The tool is done → ToolManager switches to the default tool. */
  finish(): void;
}

export interface ToolDescriptor {
  readonly id: string;
  readonly label: string;
  /** Icon name, the UI translates it. */
  readonly icon: string;
  /** 'draw' and 'constrain' since M12 (the sketcher toolbar). */
  readonly group: 'select' | 'primitive' | 'sketch' | 'feature' | 'modify' | 'draw' | 'constrain';
  /** Modes the tool exists in; default ['model'] (M12, see toolModes). */
  readonly modes?: readonly Mode[];
  /** Information for the UI only; app registers the shortcut as an action. */
  readonly shortcut?: string;
  create(): Tool;
}

/** Key = id, see core. */
export type ToolRegistry = Registry<ToolDescriptor>;

export function createToolRegistry(): ToolRegistry {
  return createRegistry<ToolDescriptor>({ what: 'tool', keyOf: (d) => d.id });
}
