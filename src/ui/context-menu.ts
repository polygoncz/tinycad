import type { ActionState } from '@/interaction';

// The items of the shared ContextMenu (spec 11, "Komponenty"): an ActionState, optionally with
// an icon. A ToolbarItem is one as it is (its icon is required), the File menu and the menu of
// the Timeline give plain ActionStates without one.

/** An item of ContextMenu; `icon` is a Tabler icon name without the `ti-` prefix. */
export type ContextMenuItem = ActionState & { readonly icon?: string };

/**
 * Whether the menu has the column of icons: at least one item has an icon. Then an item without
 * one keeps an empty room of the same width, so the labels stay aligned.
 */
export function menuHasIcons(items: readonly ContextMenuItem[]): boolean {
  return items.some((item) => item.icon !== undefined);
}
