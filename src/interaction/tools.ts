// Tools (spec 10, "Nástroje"): a tool turns viewport events into operations. The
// descriptor carries the identity and creates a fresh tool on every activation.

import { createRegistry } from '@/core';
import type { IdGenerator, Registry } from '@/core';
import type { DocumentReader } from '@/document';
import type { OperationDispatcher } from '@/ops';
import type { FeatureEditor } from './feature-editor';
import type { Mode } from './mode';
import type { SelectionCommands } from './selection';
import type { ViewKeyEvent, ViewPointerEvent, ViewportPort } from './viewport-port';

export interface Tool {
  activate(ctx: ToolContext): void;
  deactivate(): void;
  onPointer?(e: ViewPointerEvent): void;
  /** true = the event was handled. */
  onKey?(e: ViewKeyEvent): boolean;
}

export interface ToolContext {
  /** pick, overlay, screenToRay */
  readonly viewport: ViewportPort;
  readonly selection: SelectionCommands;
  readonly doc: DocumentReader;
  /**
   * Single operations only (Q069): a transaction is opened by FeatureEditor or SketchEditor
   * alone, so a tool cannot run one alongside the dialog.
   */
  readonly ops: Pick<OperationDispatcher, 'dispatch' | 'inTransaction'>;
  readonly ids: IdGenerator;
  /** Creating/editing a feature through the dialog. */
  readonly features: FeatureEditor;
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

const MODEL_ONLY: readonly Mode[] = Object.freeze(['model']);

/** The modes of the tool: its own, or ['model'] when it does not say. */
export function toolModes(d: ToolDescriptor): readonly Mode[] {
  return d.modes ?? MODEL_ONLY;
}

/** Key = id, see core. */
export type ToolRegistry = Registry<ToolDescriptor>;

export function createToolRegistry(): ToolRegistry {
  return createRegistry<ToolDescriptor>({ what: 'tool', keyOf: (d) => d.id });
}
