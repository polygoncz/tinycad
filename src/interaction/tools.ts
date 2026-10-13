// Tools (spec 10, "Nástroje"): a tool turns viewport events into operations. The
// descriptor carries the identity and creates a fresh tool on every activation.

import { createRegistry } from '@/core';
import type { IdGenerator, Registry } from '@/core';
import type { DocumentReader } from '@/document';
import type { OperationDispatcher } from '@/ops';
import type { FeatureEditor } from './feature-editor';
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
  readonly ops: OperationDispatcher;
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
  readonly group: 'select' | 'primitive' | 'sketch' | 'feature' | 'modify';
  /** Information for the UI only; app registers the shortcut as an action. */
  readonly shortcut?: string;
  create(): Tool;
}

/** Key = id, see core. */
export type ToolRegistry = Registry<ToolDescriptor>;

export function createToolRegistry(): ToolRegistry {
  return createRegistry<ToolDescriptor>({ what: 'tool', keyOf: (d) => d.id });
}
