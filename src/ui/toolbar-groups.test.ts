import { describe, expect, it } from 'vitest';
import type { ActionState, ToolDescriptor } from '@/interaction';
import { toolbarGroups } from './toolbar-groups';

function aTool(id: string, group: ToolDescriptor['group'], shortcut?: string): ToolDescriptor {
  return {
    id,
    label: `${id}.label`,
    icon: id,
    group,
    ...(shortcut === undefined ? {} : { shortcut }),
    create: () => {
      throw new Error('not used');
    },
  };
}

function anAction(id: string, enabled = true, shortcut: string | null = null): ActionState {
  return { id, label: id, shortcut, group: null, enabled };
}

const ACTIONS: readonly ActionState[] = [
  anAction('undo', true, 'Mod+Z'),
  anAction('redo', false, 'Mod+Shift+Z'),
  anAction('feature.delete'),
  anAction('view.fitAll', true, 'F'),
  anAction('tool.box', true, 'B'),
];

describe('toolbarGroups', () => {
  it('orders history, create, modify, view; unknown groups go last', () => {
    const tools = [
      aTool('select', 'select'),
      aTool('chamfer', 'modify'),
      aTool('box', 'primitive', 'B'),
      aTool('sketch', 'sketch'),
    ];
    const groups = toolbarGroups({ tools, actions: ACTIONS, locked: false });
    expect(groups.map((g) => g.id)).toEqual([
      'history',
      'primitive',
      'modify',
      'view',
      'select',
      'sketch',
    ]);
  });

  it('leaves out empty groups', () => {
    const groups = toolbarGroups({ tools: [], actions: [], locked: false });
    expect(groups).toEqual([]);
  });

  it('history and view are the actions with their state', () => {
    const groups = toolbarGroups({ tools: [], actions: ACTIONS, locked: false });
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

  it('a tool with an action runs and is enabled through it', () => {
    const disabled = ACTIONS.map((a) => (a.id === 'tool.box' ? { ...a, enabled: false } : a));
    const [, create] = toolbarGroups({
      tools: [aTool('box', 'primitive', 'B')],
      actions: disabled,
      locked: false,
    });
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
    const open = toolbarGroups({ tools, actions: [], locked: false });
    const locked = toolbarGroups({ tools, actions: [], locked: true });
    expect(open[0]?.items[0]?.command).toEqual({ kind: 'tool', id: 'chamfer' });
    expect(open[0]?.items[0]?.enabled).toBe(true);
    expect(open[0]?.items[0]?.shortcut).toBeNull();
    expect(locked[0]?.items[0]?.enabled).toBe(false);
  });
});
