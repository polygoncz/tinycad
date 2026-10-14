import type { AppSession } from '@/app';
import type { ActionState, Mode, ToolDescriptor } from '@/interaction';

// The groups of the Toolbar (spec 11, "Komponenty"): Historie, Skica, Vytvořit, Upravit,
// Konstrukce, Zobrazit, Výběr in the model mode; Historie, Výběr, Kreslit, Vazby, Dokončit,
// Zobrazit in the sketch mode (M12). Tools fall into groups by ToolDescriptor.group and show only
// in their modes; undo/redo, fit all, the constraints (the action group 'sketch.constraint') and
// finish/cancel of a sketch are actions. The standard views (M19.2, D8) are items of the group
// 'view' only in its menu, not buttons.
// A pure function of the snapshots, so the Toolbar component holds only bindings (rule 4).
// The label of a group is the translation key `toolbar.group.<id>`.

/** What a button does: run an action of the ActionRegistry, or activate a tool directly. */
export type ToolbarCommand =
  { readonly kind: 'action'; readonly id: string } | { readonly kind: 'tool'; readonly id: string };

/**
 * A button, and at the same time an item of the menu under its group label: it is an
 * ActionState (id = the item, group = the toolbar group, modes of its tool or action), so the
 * menu shows the items as they are.
 */
export interface ToolbarItem extends ActionState {
  readonly group: string;
  /** Tabler icon name without the `ti-` prefix. */
  readonly icon: string;
  readonly command: ToolbarCommand;
  /** Only in the menu of the group and of "…", not drawn as a button (the standard views). */
  readonly menuOnly: boolean;
}

export interface ToolbarGroup {
  readonly id: string;
  readonly items: readonly ToolbarItem[];
}

/** Known groups per mode in toolbar order; groups of tools not listed here follow at the end. */
const GROUP_ORDER: Readonly<Record<Mode, readonly string[]>> = {
  model: ['history', 'sketch', 'feature', 'primitive', 'modify', 'construction', 'view', 'select'],
  sketch: ['history', 'select', 'draw', 'constrain', 'finish', 'view'],
};

/** The ids of the actions the toolbar shows as buttons; ui passes AppSession.actionIds. */
export type ToolbarActionIds = Readonly<
  Record<
    | 'undo'
    | 'redo'
    | 'fitAll'
    | 'viewFront'
    | 'viewBack'
    | 'viewRight'
    | 'viewLeft'
    | 'viewTop'
    | 'viewBottom'
    | 'viewIso',
    string
  >
>;

/** The ids of finish and cancel of a sketch; ui passes AppSession.sketchActionIds. */
export type ToolbarSketchActionIds = Readonly<Record<'finish' | 'cancel', string>>;

type ConstraintKind = Parameters<AppSession['sketchConstraintActionId']>[0];

/**
 * The action group of the geometric constraints (spec 10, "Nástroje a akce skicáře"): its actions
 * are the buttons of the toolbar group 'constrain', after the dimension tool, in registration order.
 */
const CONSTRAINT_ACTION_GROUP = 'sketch.constraint';
const CONSTRAINT_TOOLBAR_GROUP = 'constrain';

/** Icons of the constraint actions; an action without one gets DEFAULT_CONSTRAINT_ICON. */
const CONSTRAINT_ICONS: readonly (readonly [ConstraintKind, string])[] = [
  ['coincident', 'point'],
  ['horizontal', 'arrows-horizontal'],
  ['vertical', 'arrows-vertical'],
  ['parallel', 'slashes'],
  ['perpendicular', 'angle'],
  ['equal', 'equal'],
  ['tangent', 'circle-dot'],
  ['fix', 'lock'],
];
const DEFAULT_CONSTRAINT_ICON = 'link';

interface ButtonSpec {
  readonly id: string;
  readonly icon: string;
  readonly menuOnly?: boolean;
}

type Buttons = Readonly<Record<string, readonly ButtonSpec[]>>;

/**
 * The actions shown as buttons by a fixed id, by group, before the tools of the group. The
 * sketch actions are buttons only in the sketch mode; the standard views follow fit all in the
 * menu only, in both modes.
 */
function actionButtons(input: {
  readonly mode: Mode;
  readonly actionIds: ToolbarActionIds;
  readonly sketchActionIds: ToolbarSketchActionIds;
}): Buttons {
  const { actionIds: ids, sketchActionIds: sketch } = input;
  const history = [
    { id: ids.undo, icon: 'arrow-back-up' },
    { id: ids.redo, icon: 'arrow-forward-up' },
  ];
  const view: readonly ButtonSpec[] = [
    { id: ids.fitAll, icon: 'zoom-scan' },
    ...[ids.viewFront, ids.viewBack, ids.viewRight, ids.viewLeft, ids.viewTop, ids.viewBottom].map(
      (id) => ({ id, icon: 'square', menuOnly: true }),
    ),
    { id: ids.viewIso, icon: 'cube', menuOnly: true },
  ];
  if (input.mode === 'model') return { history, view };
  return {
    history,
    finish: [
      { id: sketch.cancel, icon: 'x' },
      { id: sketch.finish, icon: 'check' },
    ],
    view,
  };
}

/** The item of an action button in the toolbar group `group`. */
function actionItem(
  action: ActionState,
  group: string,
  icon: string,
  menuOnly = false,
): ToolbarItem {
  return Object.freeze({
    id: action.id,
    label: action.label,
    shortcut: action.shortcut,
    group,
    enabled: action.enabled,
    modes: action.modes,
    icon,
    command: Object.freeze({ kind: 'action', id: action.id }),
    menuOnly,
  });
}

export function toolbarGroups(input: {
  readonly tools: readonly ToolDescriptor[];
  readonly actions: readonly ActionState[];
  readonly actionIds: ToolbarActionIds;
  /** AppSession.toolActionId: the action that activates a tool, if app registered one. */
  readonly toolActionId: (toolId: string) => string;
  /** AppSession.toolModes: the modes of a tool without an action (with one: ActionState.modes). */
  readonly toolModes: (tool: ToolDescriptor) => readonly Mode[];
  /** AppSession.locked: tools without an action are disabled. */
  readonly locked: boolean;
  /** AppSession.mode: only the tools, actions and groups of this mode are shown (M12). */
  readonly mode: Mode;
  /** AppSession.sketchActionIds. */
  readonly sketchActionIds: ToolbarSketchActionIds;
  /** AppSession.sketchConstraintActionId: finds the icon of a constraint action. */
  readonly sketchConstraintActionId: (kind: ConstraintKind) => string;
}): readonly ToolbarGroup[] {
  const actionById = new Map(input.actions.map((a) => [a.id, a]));
  const items = new Map<string, ToolbarItem[]>();
  const add = (item: ToolbarItem): void => {
    const list = items.get(item.group);
    if (list === undefined) items.set(item.group, [item]);
    else list.push(item);
  };

  for (const [group, list] of Object.entries(actionButtons(input))) {
    for (const { id, icon, menuOnly } of list) {
      const action = actionById.get(id);
      if (action !== undefined) add(actionItem(action, group, icon, menuOnly));
    }
  }

  for (const tool of input.tools) {
    const action = actionById.get(input.toolActionId(tool.id));
    const modes = action?.modes ?? input.toolModes(tool);
    if (!modes.includes(input.mode)) continue;
    add(
      Object.freeze({
        id: tool.id,
        label: tool.label,
        shortcut: tool.shortcut ?? null,
        group: tool.group,
        enabled: action?.enabled ?? !input.locked,
        modes,
        icon: tool.icon,
        command: Object.freeze(
          action === undefined ? { kind: 'tool', id: tool.id } : { kind: 'action', id: action.id },
        ),
        menuOnly: false,
      }),
    );
  }

  const constraintIcons = new Map(
    CONSTRAINT_ICONS.map(([kind, icon]) => [input.sketchConstraintActionId(kind), icon]),
  );
  for (const action of input.actions) {
    if (action.group !== CONSTRAINT_ACTION_GROUP || !action.modes.includes(input.mode)) continue;
    const icon = constraintIcons.get(action.id) ?? DEFAULT_CONSTRAINT_ICON;
    add(actionItem(action, CONSTRAINT_TOOLBAR_GROUP, icon));
  }

  const order = GROUP_ORDER[input.mode];
  const unknown = [...items.keys()].filter((group) => !order.includes(group));
  return Object.freeze(
    [...order, ...unknown].flatMap((id) => {
      const list = items.get(id);
      return list === undefined ? [] : [Object.freeze({ id, items: Object.freeze(list) })];
    }),
  );
}
