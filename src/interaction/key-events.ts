// Small helpers over ViewKeyEvent shared by ToolManager and tools.

import type { ViewKeyEvent } from './viewport-port';

/** Escape without modifiers outside a text field: ends a tool or clears the selection. */
export function isPlainEscape(e: ViewKeyEvent): boolean {
  return e.key === 'Escape' && !e.mods.shift && !e.mods.alt && !e.mods.mod && !e.inTextField;
}
