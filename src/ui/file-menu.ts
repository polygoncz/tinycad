import type { ActionState } from '@/interaction';

// The File menu of the TitleBar (spec 11, "Komponenty", M15, R124): the actions of the group
// 'file' of the ActionRegistry, disabled ones too (the menu shows them grey).

/** The action group of the File menu (interaction's createFileActions). */
const FILE_GROUP = 'file';

/** The items of the File menu in registration order. */
export function fileMenuItems(actions: readonly ActionState[]): readonly ActionState[] {
  return actions.filter((action) => action.group === FILE_GROUP);
}
