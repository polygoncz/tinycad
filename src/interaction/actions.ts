// ActionRegistry (spec 10, "Akce a klávesové zkratky"): named commands with an optional
// shortcut. app registers them, ui builds menus and toolbars from the `actions` snapshot.

import { DisposableStore, ObservableValue } from '@/core';
import type { Observable } from '@/core';
import { keyEventToShortcut, parseShortcut } from './shortcut';
import type { ViewKeyEvent } from './viewport-port';

export interface Action {
  /** E.g. 'edit.undo'. */
  readonly id: string;
  readonly label: string;
  /** E.g. 'Mod+Z' (Mod = Cmd on macOS, Ctrl elsewhere). */
  readonly shortcut?: string;
  /** The registry subscribes to it, so the snapshot follows without manual refresh (Q067). */
  readonly enabled: Observable<boolean>;
  run(): void;
}

export interface ActionState {
  readonly id: string;
  readonly label: string;
  readonly shortcut: string | null;
  readonly enabled: boolean;
}

export interface ActionRegistry {
  /** In registration order. */
  readonly actions: Observable<readonly ActionState[]>;
  /** Duplicate id, duplicate shortcut (after normalization) or an invalid shortcut throws. */
  register(a: Action): void;
  /** false = the action is disabled. Unknown id throws. */
  run(id: string): boolean;
  /** Finds the action by its shortcut; true also for a disabled one (the shortcut is ours). */
  handleKey(e: ViewKeyEvent): boolean;
  /** Unsubscribes from enabled of all actions. */
  dispose(): void;
}

function toState(a: Action): ActionState {
  return Object.freeze({
    id: a.id,
    label: a.label,
    shortcut: a.shortcut ?? null,
    enabled: a.enabled.get(),
  });
}

export function createActionRegistry(): ActionRegistry {
  const byId = new Map<string, Action>();
  // Canonical shortcut → action id.
  const byShortcut = new Map<string, string>();
  const actions = new ObservableValue<readonly ActionState[]>(Object.freeze([]));
  const subscriptions = new DisposableStore();

  // Replaces only the state of the changed action; the others stay identical (===).
  function refresh(id: string): void {
    const action = byId.get(id);
    if (action === undefined) return;
    const enabled = action.enabled.get();
    const current = actions.get();
    const index = current.findIndex((s) => s.id === id);
    const old = current[index];
    if (old === undefined || old.enabled === enabled) return;
    const next = [...current];
    next[index] = toState(action);
    actions.set(Object.freeze(next));
  }

  function get(id: string): Action {
    const action = byId.get(id);
    if (action === undefined) throw new Error(`Unknown action '${id}'`);
    return action;
  }

  function runAction(action: Action): boolean {
    if (!action.enabled.get()) return false;
    action.run();
    return true;
  }

  return {
    actions: actions.asObservable(),

    register(a) {
      // Validate everything before changing anything.
      if (byId.has(a.id)) throw new Error(`Duplicate action '${a.id}'`);
      const shortcut = a.shortcut === undefined ? null : parseShortcut(a.shortcut);
      if (shortcut !== null) {
        const owner = byShortcut.get(shortcut);
        if (owner !== undefined) {
          throw new Error(
            `Shortcut '${a.shortcut ?? ''}' of action '${a.id}' is used by '${owner}'`,
          );
        }
        byShortcut.set(shortcut, a.id);
      }
      byId.set(a.id, a);
      actions.set(Object.freeze([...actions.get(), toState(a)]));
      subscriptions.add(
        a.enabled.subscribe(() => {
          refresh(a.id);
        }),
      );
    },

    run: (id) => runAction(get(id)),

    handleKey(e) {
      if (e.inTextField) return false;
      const id = byShortcut.get(keyEventToShortcut(e.key, e.mods));
      if (id === undefined) return false;
      runAction(get(id));
      return true;
    },

    dispose: () => {
      subscriptions.dispose();
    },
  };
}
