import type { ActionState, ToolDescriptor } from '@/interaction';

// The groups of the Toolbar (spec 11, "Komponenty"): Historie, Vytvořit, Upravit, Konstrukce,
// Zobrazit. Tools fall into groups by ToolDescriptor.group; undo/redo and fit all are actions.
// A pure function of the snapshots, so the Toolbar component holds only bindings (rule 4).
// The label of a group is the translation key `toolbar.group.<id>`.

/** What a button does: run an action of the ActionRegistry, or activate a tool directly. */
export type ToolbarCommand =
  { readonly kind: 'action'; readonly id: string } | { readonly kind: 'tool'; readonly id: string };

export interface ToolbarItem {
  readonly id: string;
  /** Translation key. */
  readonly label: string;
  /** Tabler icon name without the `ti-` prefix. */
  readonly icon: string;
  /** For the tooltip; null = none. */
  readonly shortcut: string | null;
  readonly enabled: boolean;
  readonly command: ToolbarCommand;
}

export interface ToolbarGroup {
  readonly id: string;
  readonly items: readonly ToolbarItem[];
}

/** Known groups in toolbar order; groups of tools not listed here follow at the end. */
const GROUP_ORDER: readonly string[] = ['history', 'primitive', 'modify', 'construction', 'view'];

/** The ids of the actions the toolbar shows as buttons; ui passes AppSession.actionIds. */
export type ToolbarActionIds = Readonly<Record<'undo' | 'redo' | 'fitAll', string>>;

/** The actions shown as buttons, by group, with their icons. */
function actionButtons(
  ids: ToolbarActionIds,
): Readonly<Record<string, readonly { id: string; icon: string }[]>> {
  return {
    history: [
      { id: ids.undo, icon: 'arrow-back-up' },
      { id: ids.redo, icon: 'arrow-forward-up' },
    ],
    view: [{ id: ids.fitAll, icon: 'zoom-scan' }],
  };
}

export function toolbarGroups(input: {
  readonly tools: readonly ToolDescriptor[];
  readonly actions: readonly ActionState[];
  readonly actionIds: ToolbarActionIds;
  /** AppSession.toolActionId: the action that activates a tool, if app registered one. */
  readonly toolActionId: (toolId: string) => string;
  /** AppSession.locked: tools without an action are disabled. */
  readonly locked: boolean;
}): readonly ToolbarGroup[] {
  const actionById = new Map(input.actions.map((a) => [a.id, a]));
  const items = new Map<string, ToolbarItem[]>();
  const add = (group: string, item: ToolbarItem): void => {
    const list = items.get(group);
    if (list === undefined) items.set(group, [item]);
    else list.push(item);
  };

  for (const [group, buttons] of Object.entries(actionButtons(input.actionIds))) {
    for (const { id, icon } of buttons) {
      const action = actionById.get(id);
      if (action === undefined) continue;
      add(group, {
        id,
        label: action.label,
        icon,
        shortcut: action.shortcut,
        enabled: action.enabled,
        command: { kind: 'action', id },
      });
    }
  }
  for (const tool of input.tools) {
    const action = actionById.get(input.toolActionId(tool.id));
    add(tool.group, {
      id: tool.id,
      label: tool.label,
      icon: tool.icon,
      shortcut: tool.shortcut ?? null,
      enabled: action?.enabled ?? !input.locked,
      command:
        action === undefined ? { kind: 'tool', id: tool.id } : { kind: 'action', id: action.id },
    });
  }

  const unknown = [...items.keys()].filter((group) => !GROUP_ORDER.includes(group));
  return Object.freeze(
    [...GROUP_ORDER, ...unknown].flatMap((id) => {
      const list = items.get(id);
      return list === undefined ? [] : [Object.freeze({ id, items: Object.freeze(list) })];
    }),
  );
}
