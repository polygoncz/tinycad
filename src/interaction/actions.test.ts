import { ObservableValue } from '@/core';
import { describe, expect, it } from 'vitest';
import { createActionRegistry } from './actions';
import type { Action } from './actions';
import type { KeyMods, ViewKeyEvent } from './viewport-port';

interface TestAction extends Action {
  readonly enabledValue: ObservableValue<boolean>;
  readonly runs: () => number;
}

function anAction(
  id: string,
  opts: { shortcut?: string | readonly string[]; enabled?: boolean; group?: string } = {},
): TestAction {
  const enabledValue = new ObservableValue(opts.enabled ?? true);
  let runs = 0;
  return {
    id,
    label: `Label ${id}`,
    ...(opts.shortcut === undefined ? {} : { shortcut: opts.shortcut }),
    ...(opts.group === undefined ? {} : { group: opts.group }),
    enabled: enabledValue,
    enabledValue,
    run: () => {
      runs++;
    },
    runs: () => runs,
  };
}

function key(k: string, mods: Partial<KeyMods> = {}, inTextField = false): ViewKeyEvent {
  return { key: k, mods: { shift: false, alt: false, mod: false, ...mods }, inTextField };
}

describe('ActionRegistry', () => {
  describe('snapshot', () => {
    it('starts empty and lists actions in registration order', () => {
      const registry = createActionRegistry();
      expect(registry.actions.get()).toEqual([]);
      registry.register(anAction('edit.undo', { shortcut: 'Mod+Z' }));
      registry.register(anAction('edit.redo', { enabled: false }));
      expect(registry.actions.get()).toEqual([
        {
          id: 'edit.undo',
          label: 'Label edit.undo',
          shortcut: 'Mod+Z',
          group: null,
          enabled: true,
        },
        {
          id: 'edit.redo',
          label: 'Label edit.redo',
          shortcut: null,
          group: null,
          enabled: false,
        },
      ]);
    });

    it('carries the group of the action', () => {
      const registry = createActionRegistry();
      registry.register(anAction('feature.edit', { group: 'feature' }));
      expect(registry.actions.get()[0]?.group).toBe('feature');
    });

    it('shows the first of several shortcuts', () => {
      const registry = createActionRegistry();
      registry.register(anAction('feature.delete', { shortcut: ['Delete', 'Backspace'] }));
      expect(registry.actions.get()[0]?.shortcut).toBe('Delete');
    });

    it('is frozen', () => {
      const registry = createActionRegistry();
      registry.register(anAction('a'));
      expect(Object.isFrozen(registry.actions.get())).toBe(true);
      expect(Object.isFrozen(registry.actions.get()[0])).toBe(true);
    });

    it('a change of enabled gives a new snapshot with only that state replaced', () => {
      const registry = createActionRegistry();
      const a = anAction('a');
      const b = anAction('b');
      registry.register(a);
      registry.register(b);
      const before = registry.actions.get();
      let calls = 0;
      registry.actions.subscribe(() => calls++);

      b.enabledValue.set(false);

      const after = registry.actions.get();
      expect(calls).toBe(1);
      expect(after).not.toBe(before);
      expect(after[0]).toBe(before[0]);
      expect(after[1]).toEqual({ ...before[1], enabled: false });
    });

    it('emits nothing when enabled notifies without a change', () => {
      const registry = createActionRegistry();
      let enabled = true;
      let notify = (): void => undefined;
      registry.register({
        id: 'a',
        label: 'A',
        enabled: {
          get: () => enabled,
          subscribe: (fn) => {
            notify = fn;
            return () => undefined;
          },
        },
        run: () => undefined,
      });
      const before = registry.actions.get();
      let calls = 0;
      registry.actions.subscribe(() => calls++);

      notify();
      expect(calls).toBe(0);
      expect(registry.actions.get()).toBe(before);

      enabled = false;
      notify();
      expect(calls).toBe(1);
    });

    it('dispose unsubscribes from enabled of all actions', () => {
      const registry = createActionRegistry();
      const a = anAction('a');
      registry.register(a);
      const before = registry.actions.get();
      registry.dispose();

      a.enabledValue.set(false);
      expect(registry.actions.get()).toBe(before);
    });
  });

  describe('register', () => {
    it('throws on a duplicate id', () => {
      const registry = createActionRegistry();
      registry.register(anAction('a'));
      expect(() => {
        registry.register(anAction('a'));
      }).toThrow(/'a'/);
    });

    it('throws on a duplicate shortcut after normalization', () => {
      const registry = createActionRegistry();
      registry.register(anAction('a', { shortcut: 'Mod+Shift+Z' }));
      expect(() => {
        registry.register(anAction('b', { shortcut: 'Shift+Mod+z' }));
      }).toThrow();
    });

    it('throws on a duplicate among the alternatives of two actions', () => {
      const registry = createActionRegistry();
      registry.register(anAction('a', { shortcut: ['Delete', 'Backspace'] }));
      expect(() => {
        registry.register(anAction('b', { shortcut: ['X', 'Backspace'] }));
      }).toThrow(/Backspace/);
      // Nothing of the rejected action stays: its first shortcut is still free.
      registry.register(anAction('c', { shortcut: 'X' }));
    });

    it('throws on a duplicate within the alternatives of one action', () => {
      const registry = createActionRegistry();
      expect(() => {
        registry.register(anAction('a', { shortcut: ['Mod+Z', 'Mod+z'] }));
      }).toThrow();
      expect(registry.actions.get()).toEqual([]);
    });

    it('throws on an invalid alternative', () => {
      const registry = createActionRegistry();
      expect(() => {
        registry.register(anAction('a', { shortcut: ['Delete', 'Foo+Z'] }));
      }).toThrow();
      registry.register(anAction('b', { shortcut: 'Delete' }));
    });

    it('throws on an empty list of shortcuts', () => {
      const registry = createActionRegistry();
      expect(() => {
        registry.register(anAction('a', { shortcut: [] }));
      }).toThrow();
    });

    it('throws on an invalid shortcut', () => {
      const registry = createActionRegistry();
      expect(() => {
        registry.register(anAction('a', { shortcut: 'Foo+Z' }));
      }).toThrow();
    });

    it('a rejected action leaves the registry unchanged', () => {
      const registry = createActionRegistry();
      registry.register(anAction('a', { shortcut: 'Mod+Z' }));
      const before = registry.actions.get();
      const rejected = anAction('b', { shortcut: 'Mod+Z' });
      expect(() => {
        registry.register(rejected);
      }).toThrow();
      expect(registry.actions.get()).toBe(before);
      expect(() => registry.run('b')).toThrow();
      // Not subscribed either: a change of enabled emits nothing.
      let calls = 0;
      registry.actions.subscribe(() => calls++);
      rejected.enabledValue.set(false);
      expect(calls).toBe(0);
    });
  });

  describe('run', () => {
    it('runs an enabled action and returns true', () => {
      const registry = createActionRegistry();
      const a = anAction('a');
      registry.register(a);
      expect(registry.run('a')).toBe(true);
      expect(a.runs()).toBe(1);
    });

    it('does not run a disabled action and returns false', () => {
      const registry = createActionRegistry();
      const a = anAction('a', { enabled: false });
      registry.register(a);
      expect(registry.run('a')).toBe(false);
      expect(a.runs()).toBe(0);
    });

    it('throws on an unknown id', () => {
      const registry = createActionRegistry();
      expect(() => registry.run('nope')).toThrow(/'nope'/);
    });
  });

  describe('handleKey', () => {
    it('runs the action with a Mod shortcut', () => {
      const registry = createActionRegistry();
      const undo = anAction('edit.undo', { shortcut: 'Mod+Z' });
      registry.register(undo);
      expect(registry.handleKey(key('z', { mod: true }))).toBe(true);
      expect(undo.runs()).toBe(1);
    });

    it('matches Shift with the upper-case letter', () => {
      const registry = createActionRegistry();
      const redo = anAction('edit.redo', { shortcut: 'Mod+Shift+Z' });
      registry.register(redo);
      expect(registry.handleKey(key('Z', { mod: true, shift: true }))).toBe(true);
      expect(redo.runs()).toBe(1);
    });

    it('requires an exact match of modifiers', () => {
      const registry = createActionRegistry();
      const undo = anAction('edit.undo', { shortcut: 'Mod+Z' });
      registry.register(undo);
      expect(registry.handleKey(key('Z', { mod: true, shift: true }))).toBe(false);
      expect(registry.handleKey(key('z'))).toBe(false);
      expect(registry.handleKey(key('z', { mod: true, alt: true }))).toBe(false);
      expect(undo.runs()).toBe(0);
    });

    it('matches a named key without modifiers', () => {
      const registry = createActionRegistry();
      const del = anAction('edit.delete', { shortcut: 'Delete' });
      registry.register(del);
      expect(registry.handleKey(key('Delete'))).toBe(true);
      expect(del.runs()).toBe(1);
    });

    it('runs the action on any of its shortcuts', () => {
      const registry = createActionRegistry();
      const del = anAction('feature.delete', { shortcut: ['Delete', 'Backspace'] });
      registry.register(del);
      expect(registry.handleKey(key('Delete'))).toBe(true);
      expect(registry.handleKey(key('Backspace'))).toBe(true);
      expect(del.runs()).toBe(2);
    });

    it('ignores keys in a text field', () => {
      const registry = createActionRegistry();
      const undo = anAction('edit.undo', { shortcut: 'Mod+Z' });
      registry.register(undo);
      expect(registry.handleKey(key('z', { mod: true }, true))).toBe(false);
      expect(undo.runs()).toBe(0);
    });

    it('claims the shortcut of a disabled action without running it', () => {
      const registry = createActionRegistry();
      const undo = anAction('edit.undo', { shortcut: 'Mod+Z', enabled: false });
      registry.register(undo);
      expect(registry.handleKey(key('z', { mod: true }))).toBe(true);
      expect(undo.runs()).toBe(0);
    });

    it('returns false when no action has the shortcut', () => {
      const registry = createActionRegistry();
      registry.register(anAction('a'));
      expect(registry.handleKey(key('F2'))).toBe(false);
    });
  });
});
