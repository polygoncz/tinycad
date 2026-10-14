import type { AppSession } from '@/app';
import type { ActionState, Mode, ToolDescriptor } from '@/interaction';

// The groups of the Toolbar (spec 11, "Komponenty"): Historie, Skica, Vytvořit, Upravit,
// Konstrukce, Zobrazit, Výběr in the model mode; Historie, Výběr, Kreslit, Vazby, Dokončit,
// Zobrazit in the sketch mode (M12). Tools fall into groups by ToolDescriptor.group and show only
// in their modes; undo/redo, fit all, the constraints and finish/cancel of a sketch are actions.
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

/** Known groups per mode in toolbar order; groups of tools not listed here follow at the end. */
const GROUP_ORDER: Readonly<Record<Mode, readonly string[]>> = {
  model: ['history', 'sketch', 'feature', 'primitive', 'modify', 'construction', 'view', 'select'],
  sketch: ['history', 'select', 'draw', 'constrain', 'finish', 'view'],
};

/** The ids of the actions the toolbar shows as buttons; ui passes AppSession.actionIds. */
export type ToolbarActionIds = Readonly<Record<'undo' | 'redo' | 'fitAll', string>>;

/** The ids of finish and cancel of a sketch; ui passes AppSession.sketchActionIds. */
export type ToolbarSketchActionIds = Readonly<Record<'finish' | 'cancel', string>>;

type ConstraintKind = Parameters<AppSession['sketchConstraintActionId']>[0];

/** Icons of the constraint actions, in toolbar order (the order of GEOMETRIC_CONSTRAINT_KINDS). */
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

type Buttons = Readonly<Record<string, readonly { readonly id: string; readonly icon: string }[]>>;

/**
 * The actions shown as buttons, by group: `before` the tools of the group, `after` them (the
 * constraints follow the dimension tool). The sketch actions are buttons only in the sketch mode.
 */
function actionButtons(input: {
  readonly mode: Mode;
  readonly actionIds: ToolbarActionIds;
  readonly sketchActionIds: ToolbarSketchActionIds;
  readonly sketchConstraintActionId: (kind: ConstraintKind) => string;
}): { readonly before: Buttons; readonly after: Buttons } {
  const { actionIds: ids, sketchActionIds: sketch } = input;
  const history = [
    { id: ids.undo, icon: 'arrow-back-up' },
    { id: ids.redo, icon: 'arrow-forward-up' },
  ];
  const view = [{ id: ids.fitAll, icon: 'zoom-scan' }];
  if (input.mode === 'model') return { before: { history, view }, after: {} };
  return {
    before: {
      history,
      finish: [
        { id: sketch.cancel, icon: 'x' },
        { id: sketch.finish, icon: 'check' },
      ],
      view,
    },
    after: {
      constrain: CONSTRAINT_ICONS.map(([kind, icon]) => ({
        id: input.sketchConstraintActionId(kind),
        icon,
      })),
    },
  };
}

/**
 * The modes of a tool: its own, or ['model'] (spec 10, "Režim"). ui may not import the value
 * toolModes of interaction, so the default is repeated here.
 */
function modesOf(tool: ToolDescriptor): readonly Mode[] {
  return tool.modes ?? ['model'];
}

export function toolbarGroups(input: {
  readonly tools: readonly ToolDescriptor[];
  readonly actions: readonly ActionState[];
  readonly actionIds: ToolbarActionIds;
  /** AppSession.toolActionId: the action that activates a tool, if app registered one. */
  readonly toolActionId: (toolId: string) => string;
  /** AppSession.locked: tools without an action are disabled. */
  readonly locked: boolean;
  /** AppSession.mode: only the tools and the groups of this mode are shown (M12). */
  readonly mode: Mode;
  /** AppSession.sketchActionIds. */
  readonly sketchActionIds: ToolbarSketchActionIds;
  /** AppSession.sketchConstraintActionId. */
  readonly sketchConstraintActionId: (kind: ConstraintKind) => string;
}): readonly ToolbarGroup[] {
  const actionById = new Map(input.actions.map((a) => [a.id, a]));
  const items = new Map<string, ToolbarItem[]>();
  const add = (group: string, item: ToolbarItem): void => {
    const list = items.get(group);
    if (list === undefined) items.set(group, [item]);
    else list.push(item);
  };
  const addActions = (buttons: Buttons): void => {
    for (const [group, list] of Object.entries(buttons)) {
      for (const { id, icon } of list) {
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
  };

  const buttons = actionButtons(input);
  addActions(buttons.before);
  for (const tool of input.tools) {
    if (!modesOf(tool).includes(input.mode)) continue;
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
  addActions(buttons.after);

  const order = GROUP_ORDER[input.mode];
  const unknown = [...items.keys()].filter((group) => !order.includes(group));
  return Object.freeze(
    [...order, ...unknown].flatMap((id) => {
      const list = items.get(id);
      return list === undefined ? [] : [Object.freeze({ id, items: Object.freeze(list) })];
    }),
  );
}
