import { describe, expect, it } from 'vitest';
import type { ActionState, Mode, ToolDescriptor } from '@/interaction';
import { toolbarGroups } from './toolbar-groups';
import type { ToolbarGroup } from './toolbar-groups';

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

/** A constraint action of the sketcher: the group and the mode of createSketchActions. */
function aConstraintAction(id: string, shortcut: string | null = null): ActionState {
  return anAction(id, false, shortcut, { group: 'sketch.constraint', modes: ['sketch'] });
}

/** The ids are passed in, never known by the function (AppSession.actionIds). */
const IDS = { undo: 'undo', redo: 'redo', fitAll: 'view.fitAll' } as const;
const toolActionId = (id: string): string => `tool.${id}`;
const SKETCH_IDS = { finish: 'sketch.finish', cancel: 'sketch.cancel' } as const;
const constraintActionId = (kind: string): string => `sketch.constraint.${kind}`;

type Input = Parameters<typeof toolbarGroups>[0];

/** The inputs every call shares; the tests override what they look at. */
function groupsOf(
  input: Partial<Input> & Pick<Input, 'tools' | 'actions'>,
): readonly ToolbarGroup[] {
  return toolbarGroups({
    actionIds: IDS,
    toolActionId,
    // AppSession.toolModes in the app; the default of interaction.
    toolModes: (tool) => tool.modes ?? ['model'],
    locked: false,
    mode: 'model',
    sketchActionIds: SKETCH_IDS,
    sketchConstraintActionId: constraintActionId,
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
      },
    ]);
    expect(groups[1]?.items.map((i) => i.id)).toEqual(['view.fitAll']);
  });

  it('finds the action buttons by the ids it is given', () => {
    const ids = { undo: 'my.undo', redo: 'my.redo', fitAll: 'my.fit' };
    const actions = [anAction('my.undo'), anAction('undo'), anAction('my.fit')];
    const groups = groupsOf({ tools: [], actions, actionIds: ids });
    expect(groups.map((g) => g.items.map((i) => i.command))).toEqual([
      [{ kind: 'action', id: 'my.undo' }],
      [{ kind: 'action', id: 'my.fit' }],
    ]);
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

  it('in the model mode only the tools of the model are shown, no sketch actions', () => {
    const groups = groupsOf({ tools: SKETCHER_TOOLS, actions: SKETCHER_ACTIONS });
    expect(groups.map((g) => [g.id, g.items.map((i) => i.id)])).toEqual([
      ['history', ['undo', 'redo']],
      ['sketch', ['sketch']],
      ['primitive', ['box']],
      ['view', ['view.fitAll']],
      ['select', ['select']],
    ]);
  });

  it('in the sketch mode: history, select, draw, constrain, finish, view', () => {
    const groups = groupsOf({ tools: SKETCHER_TOOLS, actions: SKETCHER_ACTIONS, mode: 'sketch' });
    expect(groups.map((g) => [g.id, g.items.map((i) => i.id)])).toEqual([
      ['history', ['undo', 'redo']],
      ['select', ['sketch.select']],
      ['draw', ['sketch.line', 'sketch.rectangle']],
      [
        'constrain',
        [
          'sketch.dimension',
          'sketch.constraint.coincident',
          'sketch.constraint.horizontal',
          'sketch.constraint.vertical',
          'sketch.constraint.parallel',
          'sketch.constraint.perpendicular',
          'sketch.constraint.equal',
          'sketch.constraint.tangent',
          'sketch.constraint.fix',
        ],
      ],
      ['finish', ['sketch.cancel', 'sketch.finish']],
      ['view', ['view.fitAll']],
    ]);
  });

  it('the sketch actions are buttons with their icons, state and shortcut', () => {
    const groups = groupsOf({ tools: [], actions: SKETCHER_ACTIONS, mode: 'sketch' });
    const items = new Map(groups.flatMap((g) => g.items).map((i) => [i.id, i]));
    expect(items.get('sketch.finish')).toEqual({
      id: 'sketch.finish',
      label: 'sketch.finish',
      icon: 'check',
      shortcut: null,
      group: 'finish',
      enabled: true,
      modes: BOTH,
      command: { kind: 'action', id: 'sketch.finish' },
    });
    expect(items.get('sketch.cancel')?.icon).toBe('x');
    expect(items.get('sketch.constraint.horizontal')).toMatchObject({
      icon: 'arrows-horizontal',
      shortcut: 'H',
      enabled: false,
    });
    const others = [
      'coincident',
      'vertical',
      'parallel',
      'perpendicular',
      'equal',
      'tangent',
      'fix',
    ];
    expect(others.map((kind) => items.get(`sketch.constraint.${kind}`)?.icon)).toEqual([
      'point',
      'arrows-vertical',
      'slashes',
      'angle',
      'equal',
      'circle-dot',
      'lock',
    ]);
  });

  it('the constraint buttons are the actions of the group sketch.constraint in their order', () => {
    const actions = [
      aConstraintAction('sketch.constraint.fix'),
      anAction('other', true, null, { group: 'sketch', modes: ['sketch'] }),
      aConstraintAction('sketch.constraint.custom'),
      aConstraintAction('sketch.constraint.horizontal'),
    ];
    const groups = groupsOf({ tools: [], actions, mode: 'sketch' });
    expect(groups.map((g) => [g.id, g.items.map((i) => [i.id, i.icon])])).toEqual([
      [
        'constrain',
        [
          ['sketch.constraint.fix', 'lock'],
          ['sketch.constraint.custom', 'link'],
          ['sketch.constraint.horizontal', 'arrows-horizontal'],
        ],
      ],
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
    const tools = [aTool('probe', 'modify')];
    const toolModes = (): readonly Mode[] => ['sketch'];
    expect(groupsOf({ tools, actions: [], toolModes })).toEqual([]);
    const [group] = groupsOf({ tools, actions: [], toolModes, mode: 'sketch' });
    expect(group?.items[0]).toMatchObject({ id: 'probe', group: 'modify', modes: ['sketch'] });
  });
});

const SKETCHER_TOOLS: readonly ToolDescriptor[] = [
  aTool('select', 'select'),
  aTool('box', 'primitive', 'B'),
  aTool('sketch', 'sketch', 'Shift+S', ['model']),
  aTool('sketch.select', 'select', undefined, ['sketch']),
  aTool('sketch.line', 'draw', 'L', ['sketch']),
  aTool('sketch.rectangle', 'draw', 'R', ['sketch']),
  aTool('sketch.dimension', 'constrain', 'D', ['sketch']),
];

const KINDS = [
  'coincident',
  'horizontal',
  'vertical',
  'parallel',
  'perpendicular',
  'equal',
  'tangent',
  'fix',
] as const;

const SKETCHER_ACTIONS: readonly ActionState[] = [
  ...ACTIONS,
  anAction('sketch.finish'),
  anAction('sketch.cancel'),
  ...KINDS.map((kind) =>
    aConstraintAction(`sketch.constraint.${kind}`, kind === 'horizontal' ? 'H' : null),
  ),
];
