import { describe, expect, it } from 'vitest';
import type { ActionState } from '@/interaction';
import { isAdditive, runOnSelected } from '@/ui/item-actions';

describe('isAdditive', () => {
  const mods = (m: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>) => ({
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...m,
  });

  it('Shift, Ctrl or Cmd adds to the selection', () => {
    expect(isAdditive(mods({ shiftKey: true }))).toBe(true);
    expect(isAdditive(mods({ ctrlKey: true }))).toBe(true);
    expect(isAdditive(mods({ metaKey: true }))).toBe(true);
  });

  it('no modifier does not', () => {
    expect(isAdditive(mods({}))).toBe(false);
  });
});

describe('runOnSelected', () => {
  function anAction(enabled: boolean): ActionState {
    return {
      id: 'feature.delete',
      label: 'action.delete',
      shortcut: null,
      group: 'feature',
      enabled,
      modes: ['model'],
    };
  }

  function setup(enabledAfterSelect: boolean) {
    const calls: string[] = [];
    let states: readonly ActionState[] = [anAction(false)];
    const actions = {
      actions: { get: () => states, subscribe: () => () => undefined },
      run: (id: string) => {
        calls.push(`run ${id}`);
        return true;
      },
    };
    const select = (): void => {
      calls.push('select');
      states = [anAction(enabledAfterSelect)];
    };
    return { calls, actions, select };
  }

  it('selects first, then runs the action enabled for the new selection', () => {
    const { calls, actions, select } = setup(true);
    expect(runOnSelected(select, actions, 'feature.delete')).toBe(true);
    expect(calls).toEqual(['select', 'run feature.delete']);
  });

  it('does not run the action disabled after the selection', () => {
    const { calls, actions, select } = setup(false);
    expect(runOnSelected(select, actions, 'feature.delete')).toBe(false);
    expect(calls).toEqual(['select']);
  });

  it('does not run an unknown action', () => {
    const { calls, actions, select } = setup(true);
    expect(runOnSelected(select, actions, 'nope')).toBe(false);
    expect(calls).toEqual(['select']);
  });
});
