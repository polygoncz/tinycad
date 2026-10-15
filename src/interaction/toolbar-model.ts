// The Toolbar (spec 11, "Komponenty") as a presentation model (ADR 0010; M20, A3.4): the groups
// Historie, Skica, Vytvořit, Upravit, Konstrukce, Zobrazit, Výběr in the model mode. Tools fall
// into groups by ToolDescriptor.group and show only in their modes; undo/redo and fit all are
// actions in every mode, the standard views (M19.2, D8) items of the group 'view' only in its
// menu, not buttons. Any other mode (the sketch mode, M12) brings its group order and its action
// buttons as a ToolbarModeContribution from the module that owns it; interaction knows nothing of
// their content.
// The groups are a pure function of the snapshots (toolbarGroups); the model only follows its
// sources. ui keeps the fitting of the groups into the width of the bar (pixels, toolbar-fit.ts).
// The label of a group is the translation key `toolbar.group.<id>`.
// M27: the tools of one family (ToolDescriptor.family) in a group are one item, a split button
// showing the last activated tool of the family; the tools are its variants. The last activated
// tool is the state of the model (not stored), toolbarGroups gets it as an input.

import { DisposableStore, ObservableValue } from '@/core';
import type { Observable } from '@/core';
import type { ActionRegistry, ActionState } from './actions';
import { ACTION_IDS, toolActionId, toolModes } from './constants';
import type { Mode } from './mode';
import type { ToolManager } from './tool-manager';
import type { ToolDescriptor } from './tools';

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
  /**
   * The button of the active tool (ToolManager.active); never an action. Of a family: any of its
   * tools is active.
   */
  readonly active: boolean;
  /**
   * [] = a plain button. Otherwise the item of a tool family (M27): every tool of the family in
   * the group, in registration order, as plain items; the item itself is the one shown (the last
   * activated, at first the first one) with `active` of the whole family.
   */
  readonly variants: readonly ToolbarItem[];
}

export interface ToolbarGroup {
  readonly id: string;
  readonly items: readonly ToolbarItem[];
}

/** An action shown as a button by its fixed id. */
export interface ToolbarActionButton {
  readonly id: string;
  /** Tabler icon name without the `ti-` prefix. */
  readonly icon: string;
  /** Only in the menu of the group and of "…", not drawn as a button (default false). */
  readonly menuOnly?: boolean;
}

/**
 * Every action of the action group `actionGroup` (ActionState.group) that exists in the mode is a
 * button of the toolbar group `toolbarGroup`, after the tools of the group, in registration order.
 */
export interface ToolbarActionGroup {
  readonly actionGroup: string;
  readonly toolbarGroup: string;
  /** The icon of an action of the group (Tabler name without `ti-`). */
  icon(actionId: string): string;
}

/**
 * What a mode adds to the toolbar (M20): the order of its groups and the actions that are its
 * buttons. The module that owns the mode exports it and app passes it in (the sketcher for the
 * mode 'sketch'), so interaction knows nothing of its content. The model mode's own is built in.
 * History (undo, redo) and view (fit all, the standard views) are buttons in every mode.
 */
export interface ToolbarModeContribution {
  readonly mode: Mode;
  /** Known groups in toolbar order; groups not listed here follow at the end. */
  readonly groupOrder: readonly string[];
  /** Actions shown as buttons by a fixed id, by toolbar group, before the tools of the group. */
  readonly actionButtons: Readonly<Record<string, readonly ToolbarActionButton[]>>;
  readonly actionGroups: readonly ToolbarActionGroup[];
}

export interface ToolbarModel {
  /** The groups in toolbar order, without empty ones; a new frozen snapshot on every change. */
  readonly groups: Observable<readonly ToolbarGroup[]>;
  /** Runs the command of the item; a disabled item does nothing. */
  run(item: ToolbarItem): void;
  /** Unsubscribes from the sources. */
  dispose(): void;
}

/** The contribution of the model mode, the one interaction knows itself. */
const MODEL_TOOLBAR: ToolbarModeContribution = Object.freeze({
  mode: 'model',
  groupOrder: Object.freeze([
    'history',
    'sketch',
    'feature',
    'primitive',
    'modify',
    'construction',
    'view',
    'select',
  ]),
  actionButtons: Object.freeze({}),
  actionGroups: Object.freeze([]),
});

/** The group order of a mode nobody contributes to: the common groups, the rest after them. */
const COMMON_GROUP_ORDER: readonly string[] = Object.freeze(['history', 'view']);

/**
 * The buttons of every mode, before the mode's own: history, and in view fit all followed by the
 * standard views in the menu only (M19.2, D8).
 */
const COMMON_BUTTONS: Readonly<Record<string, readonly ToolbarActionButton[]>> = Object.freeze({
  history: [
    { id: ACTION_IDS.undo, icon: 'arrow-back-up' },
    { id: ACTION_IDS.redo, icon: 'arrow-forward-up' },
  ],
  view: [
    { id: ACTION_IDS.fitAll, icon: 'zoom-scan' },
    ...[
      ACTION_IDS.viewFront,
      ACTION_IDS.viewBack,
      ACTION_IDS.viewRight,
      ACTION_IDS.viewLeft,
      ACTION_IDS.viewTop,
      ACTION_IDS.viewBottom,
    ].map((id) => ({ id, icon: 'square', menuOnly: true })),
    { id: ACTION_IDS.viewIso, icon: 'cube', menuOnly: true },
  ],
});

/** The contribution of `mode`: the built-in one of the model mode, or one passed in, or none. */
function contributionOf(
  mode: Mode,
  contributions: readonly ToolbarModeContribution[],
): ToolbarModeContribution | undefined {
  return [MODEL_TOOLBAR, ...contributions].find((c) => c.mode === mode);
}

/** Throws when two contributions (the built-in one included) are for the same mode. */
function checkContributions(contributions: readonly ToolbarModeContribution[]): void {
  const seen = new Set<Mode>();
  for (const { mode } of [MODEL_TOOLBAR, ...contributions]) {
    if (seen.has(mode)) throw new Error(`Two toolbar contributions for the mode '${mode}'`);
    seen.add(mode);
  }
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
    active: false,
    variants: NO_VARIANTS,
  });
}

const NO_VARIANTS: readonly ToolbarItem[] = Object.freeze([]);

/** The tools of one family in one toolbar group, in registration order. */
interface FamilyMembers {
  readonly family: string;
  /** Never empty: a family is created with its first tool. */
  readonly items: [ToolbarItem, ...ToolbarItem[]];
}

/**
 * The item of a family: the shown tool (lastInFamily, else the first one) with all as variants; a
 * family of one tool is that tool's plain item.
 */
function familyItem(
  members: FamilyMembers,
  lastInFamily: ReadonlyMap<string, string>,
): ToolbarItem {
  const items = members.items;
  // A family of one tool (in this mode and group) is a plain button.
  if (items.length === 1) return items[0];
  const last = lastInFamily.get(members.family);
  const shown = items.find((item) => item.id === last) ?? items[0];
  return Object.freeze({
    ...shown,
    active: items.some((item) => item.active),
    variants: Object.freeze([...items]),
  });
}

/** The groups of the toolbar from the snapshots of its sources. Frozen. */
export function toolbarGroups(input: {
  readonly tools: readonly ToolDescriptor[];
  readonly actions: readonly ActionState[];
  /** ToolManager.active. */
  readonly activeTool: string;
  /** The edit lock: tools without an action are disabled. */
  readonly locked: boolean;
  /** Only the tools, actions and groups of this mode are shown (M12). */
  readonly mode: Mode;
  /** The contributions of the modes other than model (the sketcher's). */
  readonly contributions: readonly ToolbarModeContribution[];
  /** The last activated tool (id) of each family (ToolDescriptor.family), by family. */
  readonly lastInFamily: ReadonlyMap<string, string>;
}): readonly ToolbarGroup[] {
  const actionById = new Map(input.actions.map((a) => [a.id, a]));
  const items = new Map<string, ToolbarItem[]>();
  const add = (item: ToolbarItem): void => {
    const list = items.get(item.group);
    if (list === undefined) items.set(item.group, [item]);
    else list.push(item);
  };

  const contribution = contributionOf(input.mode, input.contributions);
  const common = COMMON_BUTTONS;
  const own = contribution?.actionButtons ?? {};
  for (const group of new Set([...Object.keys(common), ...Object.keys(own)])) {
    for (const { id, icon, menuOnly } of [...(common[group] ?? []), ...(own[group] ?? [])]) {
      const action = actionById.get(id);
      if (action !== undefined) add(actionItem(action, group, icon, menuOnly));
    }
  }

  // A family is held in its group by its first item until all tools are in (familyItem below).
  const families = new Map<string, FamilyMembers>();
  const familyByFirst = new Map<ToolbarItem, FamilyMembers>();
  for (const tool of input.tools) {
    const action = actionById.get(toolActionId(tool.id));
    // With an action its modes, otherwise the tool's own (the same unless app filters).
    const modes = action?.modes ?? toolModes(tool);
    if (!modes.includes(input.mode)) continue;
    const item: ToolbarItem = Object.freeze({
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
      active: input.activeTool === tool.id,
      variants: NO_VARIANTS,
    });
    if (tool.family === undefined) {
      add(item);
      continue;
    }
    // The same family in another group is another family (JSON: no separator to collide with).
    const key = JSON.stringify([tool.group, tool.family]);
    const members = families.get(key);
    if (members !== undefined) {
      members.items.push(item);
      continue;
    }
    const created: FamilyMembers = { family: tool.family, items: [item] };
    families.set(key, created);
    familyByFirst.set(item, created);
    add(item);
  }

  for (const group of contribution?.actionGroups ?? []) {
    for (const action of input.actions) {
      if (action.group !== group.actionGroup || !action.modes.includes(input.mode)) continue;
      add(actionItem(action, group.toolbarGroup, group.icon(action.id)));
    }
  }

  const order = contribution?.groupOrder ?? COMMON_GROUP_ORDER;
  const unknown = [...items.keys()].filter((group) => !order.includes(group));
  return Object.freeze(
    [...order, ...unknown].flatMap((id) => {
      const list = items.get(id)?.map((item) => {
        const members = familyByFirst.get(item);
        return members === undefined ? item : familyItem(members, input.lastInFamily);
      });
      return list === undefined ? [] : [Object.freeze({ id, items: Object.freeze(list) })];
    }),
  );
}

export function createToolbarModel(deps: {
  readonly tools: Pick<ToolManager, 'active' | 'activate'>;
  /** Every registered tool (ToolRegistry.all()). */
  readonly toolList: readonly ToolDescriptor[];
  readonly actions: Pick<ActionRegistry, 'actions' | 'run'>;
  /** The edit lock (createEditLock). */
  readonly locked: Observable<boolean>;
  readonly mode: Observable<Mode>;
  /** The contributions of the modes other than model (the sketcher's); one per mode. */
  readonly contributions: readonly ToolbarModeContribution[];
}): ToolbarModel {
  const { tools, actions } = deps;
  checkContributions(deps.contributions);
  const familyOf = new Map(
    deps.toolList.flatMap((tool) =>
      tool.family === undefined ? [] : [[tool.id, tool.family] as const],
    ),
  );
  /** The last activated tool of each family; follows ToolManager.active, not stored. */
  const lastInFamily = new Map<string, string>();
  const compute = (): readonly ToolbarGroup[] => {
    const activeTool = tools.active.get();
    const family = familyOf.get(activeTool);
    if (family !== undefined) lastInFamily.set(family, activeTool);
    return toolbarGroups({
      tools: deps.toolList,
      actions: actions.actions.get(),
      activeTool,
      locked: deps.locked.get(),
      mode: deps.mode.get(),
      contributions: deps.contributions,
      lastInFamily,
    });
  };
  const groups = new ObservableValue(compute());
  const subscriptions = new DisposableStore();
  const update = (): void => {
    groups.set(compute());
  };
  for (const source of [actions.actions, tools.active, deps.locked, deps.mode]) {
    subscriptions.add(source.subscribe(update));
  }

  function run(item: ToolbarItem): void {
    if (!item.enabled) return;
    if (item.command.kind === 'action') actions.run(item.command.id);
    else tools.activate(item.command.id);
  }

  return Object.freeze({
    groups: groups.asObservable(),
    run,
    dispose: () => {
      subscriptions.dispose();
    },
  });
}
