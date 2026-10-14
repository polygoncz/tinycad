import type { ActionState } from '@/interaction';

// The File menu of the TitleBar (spec 11, "Komponenty", M15, R124): the File actions of the
// ActionRegistry, disabled ones too (the menu shows them grey). Which actions those are comes
// from the session (AppSession.fileActionIds), not from a group name copied here.

/** The items of the File menu (ids in `fileActionIds`) in registration order. */
export function fileMenuItems(
  actions: readonly ActionState[],
  fileActionIds: readonly string[],
): readonly ActionState[] {
  const ids = new Set(fileActionIds);
  return actions.filter((action) => ids.has(action.id));
}
