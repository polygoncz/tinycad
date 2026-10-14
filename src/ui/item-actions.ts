// What the items of the Timeline and the rows of the Browser share (M19.2, revision of the
// architecture): which click or key adds to the selection, and running an action on an item
// the way the context menu does – the item becomes the selection, then the action of the
// selection runs. Pure functions over narrow ports, kept out of the components so they run in
// Node tests.

import type { ActionRegistry } from '@/interaction';

/**
 * Shift, Ctrl or Cmd adds to the selection or removes from it (spec 11): Shift like a click in
 * the view (select-tool), Ctrl/Cmd like the lists of the system. One rule for every list of ui.
 */
export function isAdditive(e: {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}): boolean {
  return e.shiftKey || e.ctrlKey || e.metaKey;
}

/**
 * Selects the item (`select`), then runs the action `id` when it is enabled for the new
 * selection; true = it ran. The state is read from the registry after the selection, not from a
 * snapshot the component held before it.
 */
export function runOnSelected(
  select: () => void,
  actions: Pick<ActionRegistry, 'actions' | 'run'>,
  id: string,
): boolean {
  select();
  const state = actions.actions.get().find((a) => a.id === id);
  return state?.enabled === true && actions.run(id);
}
