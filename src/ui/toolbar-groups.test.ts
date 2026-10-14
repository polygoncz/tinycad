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

function anAction(id: string, enabled = true, shortcut: string | null = null): ActionState {
  return { id, label: id, shortcut, group: null, enabled, modes: ['model', 'sketch'] };
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
  anAction('tool.box', true, 'B'),
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
        enabled: true,
        command: { kind: 'action', id: 'undo' },
      },
      {
        id: 'redo',
        label: 'redo',
        icon: 'arrow-forward-up',
        shortcut: 'Mod+Shift+Z',
        enabled: false,
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
        enabled: false,
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
      enabled: true,
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
    anAction(`sketch.constraint.${kind}`, false, kind === 'horizontal' ? 'H' : null),
  ),
];
