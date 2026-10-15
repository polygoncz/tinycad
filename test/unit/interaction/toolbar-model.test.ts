import { describe, expect, it, vi } from 'vitest';
import { ObservableValue } from '@/core';
import { createActionRegistry } from '@/interaction/actions';
import type { Action, ActionState } from '@/interaction/actions';
import type { Mode } from '@/interaction/mode';
import { createToolbarModel, toolbarGroups } from '@/interaction/toolbar-model';
import type { ToolbarGroup, ToolbarModeContribution } from '@/interaction/toolbar-model';
import type { ToolDescriptor } from '@/interaction/tools';

// The Toolbar (spec 11, "Komponenty") as a presentation model (M20, A3.4): the groups of the
// buttons by mode, state and order, and what a button does. ui keeps only the fitting into the
// width of the bar (toolbar-fit.ts).

function aTool(
  id: string,
  group: ToolDescriptor['group'],
  shortcut?: string,
  modes?: readonly Mode[],
): ToolDescriptor {
  return {
    id,
    label: `${id}.label`,
    icon: id,
    group,
    ...(shortcut === undefined ? {} : { shortcut }),
    ...(modes === undefined ? {} : { modes }),
    create: () => {
      throw new Error('not used');
    },
  };
}

const BOTH: readonly Mode[] = ['model', 'sketch'];

function anAction(
  id: string,
  enabled = true,
  shortcut: string | null = null,
  change: Partial<ActionState> = {},
): ActionState {
  return { id, label: id, shortcut, group: null, enabled, modes: BOTH, ...change };
}

/** An action of the action group 'probe.group' that exists only in the mode 'sketch'. */
function aProbeAction(id: string, shortcut: string | null = null): ActionState {
  return anAction(id, false, shortcut, { group: 'probe.group', modes: ['sketch'] });
}

const VIEW_ACTIONS: readonly ActionState[] = [
  'view.front',
  'view.back',
  'view.right',
  'view.left',
  'view.top',
  'view.bottom',
  'view.iso',
].map((id) => anAction(id));
/**
 * A contribution of the mode 'sketch' with neutral ids: interaction knows no content of the
 * sketcher (its own SKETCH_TOOLBAR is tested in sketcher).
 */
const PROBE_TOOLBAR: ToolbarModeContribution = {
  mode: 'sketch',
  groupOrder: ['history', 'select', 'draw', 'modify', 'done', 'view'],
  actionButtons: {
    done: [
      { id: 'probe.cancel', icon: 'x' },
      { id: 'probe.done', icon: 'check' },
    ],
    // A contributed button joins a common group after the common buttons.
    view: [{ id: 'probe.view', icon: 'eye', menuOnly: true }],
  },
  actionGroups: [
    {
      actionGroup: 'probe.group',
      toolbarGroup: 'modify',
      icon: (actionId) => (actionId === 'probe.a' ? 'lock' : 'link'),
    },
  ],
};

type Input = Parameters<typeof toolbarGroups>[0];

/** The inputs every call shares; the tests override what they look at. */
function groupsOf(
  input: Partial<Input> & Pick<Input, 'tools' | 'actions'>,
): readonly ToolbarGroup[] {
  return toolbarGroups({
    activeTool: 'select',
    locked: false,
    mode: 'model',
    contributions: [PROBE_TOOLBAR],
    ...input,
  });
}

const ACTIONS: readonly ActionState[] = [
  anAction('undo', true, 'Mod+Z'),
  anAction('redo', false, 'Mod+Shift+Z'),
  anAction('feature.delete'),
  anAction('view.fitAll', true, 'F'),
  // A tool action exists in the modes of its tool (createBuiltInActions).
  anAction('tool.box', true, 'B', { modes: ['model'] }),
];

describe('toolbarGroups', () => {
  it('orders history, sketch, create, modify, view, select; unknown groups go last', () => {
    const tools = [
      aTool('polyline', 'draw'),
      aTool('select', 'select'),
      aTool('chamfer', 'modify'),
      aTool('box', 'primitive', 'B'),
      aTool('sketch', 'sketch'),
    ];
    const groups = groupsOf({ tools, actions: ACTIONS });
    expect(groups.map((g) => g.id)).toEqual([
      'history',
      'sketch',
      'primitive',
      'modify',
      'view',
      'select',
      'draw',
    ]);
  });

  it('puts the feature group right after the sketch group (M13)', () => {
    const tools = [
      aTool('box', 'primitive', 'B'),
      aTool('extrude', 'feature', 'E'),
      aTool('sketch', 'sketch'),
      aTool('revolve', 'feature'),
    ];
    const groups = groupsOf({ tools, actions: ACTIONS });
    expect(groups.map((g) => g.id)).toEqual(['history', 'sketch', 'feature', 'primitive', 'view']);
    const feature = groups.find((g) => g.id === 'feature');
    expect(feature?.items.map((i) => i.id)).toEqual(['extrude', 'revolve']);
  });

  it('leaves out empty groups', () => {
    const groups = groupsOf({ tools: [], actions: [] });
    expect(groups).toEqual([]);
  });

  it('history and view are the actions with their state', () => {
    const groups = groupsOf({ tools: [], actions: ACTIONS });
    expect(groups[0]?.items).toEqual([
      {
        id: 'undo',
        label: 'undo',
        icon: 'arrow-back-up',
        shortcut: 'Mod+Z',
        group: 'history',
        enabled: true,
        modes: BOTH,
        command: { kind: 'action', id: 'undo' },
        menuOnly: false,
        active: false,
      },
      {
        id: 'redo',
        label: 'redo',
        icon: 'arrow-forward-up',
        shortcut: 'Mod+Shift+Z',
        group: 'history',
        enabled: false,
        modes: BOTH,
        command: { kind: 'action', id: 'redo' },
        menuOnly: false,
        active: false,
      },
    ]);
    expect(groups[1]?.items.map((i) => i.id)).toEqual(['view.fitAll']);
  });

  it('the view group has fit all as a button and the seven standard views only in the menu', () => {
    for (const mode of ['model', 'sketch'] as const) {
      const actions = [...ACTIONS, ...VIEW_ACTIONS];
      const view = groupsOf({ tools: [], actions, mode }).find((g) => g.id === 'view');
      expect(view?.items.map((i) => [i.id, i.icon, i.menuOnly])).toEqual([
        ['view.fitAll', 'zoom-scan', false],
        ['view.front', 'square', true],
        ['view.back', 'square', true],
        ['view.right', 'square', true],
        ['view.left', 'square', true],
        ['view.top', 'square', true],
        ['view.bottom', 'square', true],
        ['view.iso', 'cube', true],
      ]);
      expect(view?.items[1]?.command).toEqual({ kind: 'action', id: 'view.front' });
    }
  });

  it('a tool with an action runs and is enabled through it', () => {
    const disabled = ACTIONS.map((a) => (a.id === 'tool.box' ? { ...a, enabled: false } : a));
    const [, create] = groupsOf({ tools: [aTool('box', 'primitive', 'B')], actions: disabled });
    expect(create?.items).toEqual([
      {
        id: 'box',
        label: 'box.label',
        icon: 'box',
        shortcut: 'B',
        group: 'primitive',
        enabled: false,
        modes: ['model'],
        command: { kind: 'action', id: 'tool.box' },
        menuOnly: false,
        active: false,
      },
    ]);
  });

  it('a tool without an action is activated directly and disabled while locked', () => {
    const tools = [aTool('chamfer', 'modify')];
    const open = groupsOf({ tools, actions: [] });
    const locked = groupsOf({ tools, actions: [], locked: true });
    expect(open[0]?.items[0]?.command).toEqual({ kind: 'tool', id: 'chamfer' });
    expect(open[0]?.items[0]?.enabled).toBe(true);
    expect(open[0]?.items[0]?.shortcut).toBeNull();
    expect(locked[0]?.items[0]?.enabled).toBe(false);
  });

  it('only the button of the active tool is active, actions never', () => {
    const tools = [aTool('select', 'select'), aTool('box', 'primitive', 'B')];
    const items = groupsOf({ tools, actions: ACTIONS, activeTool: 'box' }).flatMap((g) => g.items);
    expect(items.filter((i) => i.active).map((i) => i.id)).toEqual(['box']);
    const none = groupsOf({ tools, actions: ACTIONS, activeTool: 'tool.box' });
    expect(none.flatMap((g) => g.items).some((i) => i.active)).toBe(false);
  });

  it('in the model mode only the tools of the model are shown, no contribution of another mode', () => {
    const groups = groupsOf({ tools: PROBE_TOOLS, actions: PROBE_ACTIONS });
    expect(groups.map((g) => [g.id, g.items.map((i) => i.id)])).toEqual([
      ['history', ['undo', 'redo']],
      ['sketch', ['sketch']],
      ['primitive', ['box']],
      ['view', ['view.fitAll']],
      ['select', ['select']],
    ]);
  });

  it('a contributed mode: its group order, its buttons before the tools, its action groups after', () => {
    const groups = groupsOf({ tools: PROBE_TOOLS, actions: PROBE_ACTIONS, mode: 'sketch' });
    expect(groups.map((g) => [g.id, g.items.map((i) => i.id)])).toEqual([
      ['history', ['undo', 'redo']],
      ['select', ['sketch.select']],
      ['draw', ['sketch.line', 'sketch.rectangle']],
      ['modify', ['probe.tool', 'probe.a', 'probe.b']],
      ['done', ['probe.cancel', 'probe.done']],
      ['view', ['view.fitAll', 'probe.view']],
    ]);
  });

  it('the contributed buttons are actions with their icons, state and shortcut', () => {
    const groups = groupsOf({ tools: [], actions: PROBE_ACTIONS, mode: 'sketch' });
    const items = new Map(groups.flatMap((g) => g.items).map((i) => [i.id, i]));
    expect(items.get('probe.done')).toEqual({
      id: 'probe.done',
      label: 'probe.done',
      icon: 'check',
      shortcut: null,
      group: 'done',
      enabled: true,
      modes: BOTH,
      command: { kind: 'action', id: 'probe.done' },
      menuOnly: false,
      active: false,
    });
    expect(items.get('probe.cancel')?.icon).toBe('x');
    expect(items.get('probe.view')).toMatchObject({ group: 'view', icon: 'eye', menuOnly: true });
    expect(items.get('probe.a')).toMatchObject({
      group: 'modify',
      icon: 'lock',
      shortcut: 'H',
      enabled: false,
      menuOnly: false,
    });
    expect(items.get('probe.b')?.icon).toBe('link');
  });

  it('the buttons of an action group are its actions of the mode in registration order', () => {
    const actions = [
      aProbeAction('probe.b'),
      anAction('other', true, null, { group: 'other.group', modes: ['sketch'] }),
      aProbeAction('probe.a'),
      anAction('probe.model', true, null, { group: 'probe.group', modes: ['model'] }),
    ];
    const groups = groupsOf({ tools: [], actions, mode: 'sketch' });
    expect(groups.map((g) => [g.id, g.items.map((i) => [i.id, i.icon])])).toEqual([
      [
        'modify',
        [
          ['probe.b', 'link'],
          ['probe.a', 'lock'],
        ],
      ],
    ]);
  });

  it('a mode without a contribution: history and view first, the other groups after them', () => {
    const tools = [aTool('sketch.line', 'draw', 'L', ['sketch'])];
    const groups = groupsOf({ tools, actions: PROBE_ACTIONS, mode: 'sketch', contributions: [] });
    expect(groups.map((g) => [g.id, g.items.map((i) => i.id)])).toEqual([
      ['history', ['undo', 'redo']],
      ['view', ['view.fitAll']],
      ['draw', ['sketch.line']],
    ]);
  });

  it('the modes of a tool with an action are those of the action', () => {
    const tools = [aTool('box', 'primitive', 'B')];
    const actions = [anAction('tool.box', true, 'B', { modes: ['sketch'] })];
    expect(groupsOf({ tools, actions })).toEqual([]);
    const [group] = groupsOf({ tools, actions, mode: 'sketch' });
    expect(group?.items[0]?.modes).toEqual(['sketch']);
  });

  it('a tool without an action takes its modes from toolModes', () => {
    const tools = [aTool('probe', 'modify', undefined, ['sketch'])];
    expect(groupsOf({ tools, actions: [] })).toEqual([]);
    const [group] = groupsOf({ tools, actions: [], mode: 'sketch' });
    expect(group?.items[0]).toMatchObject({ id: 'probe', group: 'modify', modes: ['sketch'] });
  });
});

const PROBE_TOOLS: readonly ToolDescriptor[] = [
  aTool('select', 'select'),
  aTool('box', 'primitive', 'B'),
  aTool('sketch', 'sketch', 'Shift+S', ['model']),
  aTool('sketch.select', 'select', undefined, ['sketch']),
  aTool('sketch.line', 'draw', 'L', ['sketch']),
  aTool('sketch.rectangle', 'draw', 'R', ['sketch']),
  aTool('probe.tool', 'modify', 'D', ['sketch']),
];

const PROBE_ACTIONS: readonly ActionState[] = [
  ...ACTIONS,
  anAction('probe.done'),
  anAction('probe.cancel'),
  anAction('probe.view'),
  aProbeAction('probe.a', 'H'),
  aProbeAction('probe.b'),
];

/** An action that counts its runs; its enabled is in the test's hands. */
function aRunnableAction(id: string, modes?: readonly Mode[]) {
  const enabled = new ObservableValue(true);
  const run = vi.fn();
  const action: Action = {
    id,
    label: id,
    enabled: enabled.asObservable(),
    run,
    ...(modes === undefined ? {} : { modes }),
  };
  return { action, enabled, run };
}

function setup() {
  const mode = new ObservableValue<Mode>('model');
  const locked = new ObservableValue(false);
  const active = new ObservableValue('select');
  const activate = vi.fn((id: string) => {
    active.set(id);
  });
  const actions = createActionRegistry({ mode: mode.asObservable() });
  const undo = aRunnableAction('undo');
  const box = aRunnableAction('tool.box', ['model']);
  actions.register(undo.action);
  actions.register(box.action);
  const toolList = [
    aTool('select', 'select'),
    aTool('box', 'primitive', 'B'),
    aTool('chamfer', 'modify'),
    aTool('sketch.line', 'draw', 'L', ['sketch']),
  ];
  const toolbar = createToolbarModel({
    tools: { active: active.asObservable(), activate },
    toolList,
    actions,
    locked: locked.asObservable(),
    mode: mode.asObservable(),
    contributions: [],
  });
  /** The item with the id; fails the test without one. */
  const item = (id: string) => {
    const found = toolbar.groups
      .get()
      .flatMap((g) => g.items)
      .find((i) => i.id === id);
    if (found === undefined) throw new Error(`no item ${id}`);
    return found;
  };
  return { toolbar, item, mode, locked, active, activate, actions, undo, box };
}

describe('createToolbarModel', () => {
  it('throws for two contributions of one mode; the one of the model mode is built in', () => {
    const { actions } = setup();
    const deps = (contributions: readonly ToolbarModeContribution[]) => ({
      tools: { active: new ObservableValue('select').asObservable(), activate: vi.fn() },
      toolList: [],
      actions,
      locked: new ObservableValue(false).asObservable(),
      mode: new ObservableValue<Mode>('model').asObservable(),
      contributions,
    });
    expect(() => createToolbarModel(deps([PROBE_TOOLBAR, PROBE_TOOLBAR]))).toThrow(/sketch/);
    expect(() => createToolbarModel(deps([{ ...PROBE_TOOLBAR, mode: 'model' }]))).toThrow(/model/);
    expect(() => {
      createToolbarModel(deps([PROBE_TOOLBAR])).dispose();
    }).not.toThrow();
  });

  it('groups the current tools and actions', () => {
    const { toolbar } = setup();
    expect(toolbar.groups.get().map((g) => [g.id, g.items.map((i) => i.id)])).toEqual([
      ['history', ['undo']],
      ['primitive', ['box']],
      ['modify', ['chamfer']],
      ['select', ['select']],
    ]);
    expect(Object.isFrozen(toolbar.groups.get())).toBe(true);
  });

  it('follows the mode', () => {
    const { toolbar, mode } = setup();
    const seen = vi.fn();
    toolbar.groups.subscribe(seen);
    mode.set('sketch');
    expect(seen).toHaveBeenCalled();
    expect(toolbar.groups.get().map((g) => g.id)).toEqual(['history', 'draw']);
  });

  it('follows the lock: a tool without an action is disabled', () => {
    const { item, locked } = setup();
    expect(item('chamfer').enabled).toBe(true);
    locked.set(true);
    expect(item('chamfer').enabled).toBe(false);
  });

  it('follows the state of the actions', () => {
    const { item, box } = setup();
    box.enabled.set(false);
    expect(item('box').enabled).toBe(false);
  });

  it('follows the active tool', () => {
    const { item, active } = setup();
    expect(item('select').active).toBe(true);
    active.set('chamfer');
    expect(item('select').active).toBe(false);
    expect(item('chamfer').active).toBe(true);
  });

  it('run: an action button runs its action, a tool without one is activated', () => {
    const { toolbar, item, activate, box, undo } = setup();
    toolbar.run(item('box'));
    expect(box.run).toHaveBeenCalledOnce();
    toolbar.run(item('undo'));
    expect(undo.run).toHaveBeenCalledOnce();
    toolbar.run(item('chamfer'));
    expect(activate).toHaveBeenCalledWith('chamfer');
  });

  it('run: a disabled item does nothing', () => {
    const { toolbar, item, locked, activate, box } = setup();
    box.enabled.set(false);
    locked.set(true);
    toolbar.run(item('box'));
    toolbar.run(item('chamfer'));
    expect(box.run).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it('dispose stops following the sources', () => {
    const { toolbar, mode, locked, active, box } = setup();
    const seen = vi.fn();
    toolbar.groups.subscribe(seen);
    toolbar.dispose();
    mode.set('sketch');
    locked.set(true);
    active.set('chamfer');
    box.enabled.set(false);
    expect(seen).not.toHaveBeenCalled();
  });
});
