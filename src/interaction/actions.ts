// ActionRegistry (spec 10, "Akce a klávesové zkratky"): named commands with an optional
// shortcut. app registers them, ui builds menus and toolbars from the `actions` snapshot.
// With a mode (M12) an action exists only in its modes: two actions may share a shortcut when
// their modes are disjoint, and handleKey looks only among the actions of the current mode.

import { DisposableStore, ObservableValue } from '@/core';
import type { Observable } from '@/core';
import { ALL_MODES } from './mode';
import type { Mode } from './mode';
import { keyEventToShortcut, parseShortcut } from './shortcut';
import type { ViewKeyEvent } from './viewport-port';

export interface Action {
  /** E.g. 'edit.undo'. */
  readonly id: string;
  readonly label: string;
  /** E.g. 'Mod+Z' (Mod = Cmd on macOS, Ctrl elsewhere); several = alternatives ('Delete', 'Backspace'). */
  readonly shortcut?: string | readonly string[];
  /** 'feature' = the context menu of a feature in the timeline (M10). */
  readonly group?: string;
  /** The registry subscribes to it, so the snapshot follows without manual refresh (Q067). */
  readonly enabled: Observable<boolean>;
  /** Modes the action exists in; default all (M12). */
  readonly modes?: readonly Mode[];
  /** M31: a toggle – its toolbar button is active while true; the registry subscribes to it. */
  readonly checked?: Observable<boolean>;
  run(): void;
}

export interface ActionState {
  readonly id: string;
  readonly label: string;
  /** The first shortcut, for display. */
  readonly shortcut: string | null;
  readonly group: string | null;
  /** action.enabled and the current mode is in `modes`. */
  readonly enabled: boolean;
  readonly modes: readonly Mode[];
  /** action.checked (M31): true/false of a toggle; null = the action is no toggle. */
  readonly checked: boolean | null;
}

export interface ActionRegistry {
  /** In registration order. */
  readonly actions: Observable<readonly ActionState[]>;
  /**
   * Duplicate id, an invalid shortcut or a shortcut (after normalization) of an action with
   * overlapping modes throws.
   */
  register(a: Action): void;
  /** false = the action is disabled or not in the current mode. Unknown id throws. */
  run(id: string): boolean;
  /**
   * Finds the action of the current mode by its shortcut; true also for a disabled one (the
   * shortcut is ours).
   */
  handleKey(e: ViewKeyEvent): boolean;
  /** Unsubscribes from enabled and checked of all actions and from the mode. */
  dispose(): void;
}

/** The shortcuts of the action as a list; none → empty. */
function shortcutsOf(a: Action): readonly string[] {
  if (a.shortcut === undefined) return [];
  return typeof a.shortcut === 'string' ? [a.shortcut] : a.shortcut;
}

function modesOf(a: Action): readonly Mode[] {
  return a.modes ?? ALL_MODES;
}

function overlap(a: readonly Mode[], b: readonly Mode[]): boolean {
  return a.some((mode) => b.includes(mode));
}

export function createActionRegistry(deps: { mode?: Observable<Mode> } = {}): ActionRegistry {
  const byId = new Map<string, Action>();
  // Canonical shortcut → ids of the actions using it (more only with disjoint modes).
  const byShortcut = new Map<string, readonly string[]>();
  const actions = new ObservableValue<readonly ActionState[]>(Object.freeze([]));
  const subscriptions = new DisposableStore();
  const modeOf = (): Mode => deps.mode?.get() ?? 'model';

  /** Enabled as the snapshot shows it: the action's own and in the current mode. */
  function isEnabled(a: Action): boolean {
    return modesOf(a).includes(modeOf()) && a.enabled.get();
  }

  function toState(a: Action): ActionState {
    return Object.freeze({
      id: a.id,
      label: a.label,
      shortcut: shortcutsOf(a)[0] ?? null,
      group: a.group ?? null,
      enabled: isEnabled(a),
      modes: modesOf(a),
      checked: a.checked?.get() ?? null,
    });
  }

  // Replaces only the states whose enabled or checked changed; the others stay identical (===).
  // One snapshot for all of them, none when nothing changed.
  function refresh(ids: Iterable<string>): void {
    const current = actions.get();
    let next: ActionState[] | null = null;
    for (const id of ids) {
      const action = byId.get(id);
      const index = current.findIndex((s) => s.id === id);
      const old = current[index];
      if (
        action === undefined ||
        old === undefined ||
        (old.enabled === isEnabled(action) && old.checked === (action.checked?.get() ?? null))
      )
        continue;
      next ??= [...current];
      next[index] = toState(action);
    }
    if (next !== null) actions.set(Object.freeze(next));
  }

  function get(id: string): Action {
    const action = byId.get(id);
    if (action === undefined) throw new Error(`Unknown action '${id}'`);
    return action;
  }

  function runAction(action: Action): boolean {
    if (!isEnabled(action)) return false;
    action.run();
    return true;
  }

  if (deps.mode !== undefined) {
    subscriptions.add(
      deps.mode.subscribe(() => {
        refresh(byId.keys());
      }),
    );
  }

  return {
    actions: actions.asObservable(),

    register(a) {
      // Validate everything before changing anything.
      if (byId.has(a.id)) throw new Error(`Duplicate action '${a.id}'`);
      const written = shortcutsOf(a);
      if (Array.isArray(a.shortcut) && written.length === 0) {
        throw new Error(`Action '${a.id}' has an empty list of shortcuts`);
      }
      const modes = modesOf(a);
      // Canonical form → the shortcut as written, for the error messages.
      const own = new Map<string, string>();
      for (const shortcut of written) {
        const canonical = parseShortcut(shortcut);
        const owner =
          (byShortcut.get(canonical) ?? []).find((id) => overlap(modesOf(get(id)), modes)) ??
          (own.has(canonical) ? a.id : undefined);
        if (owner !== undefined) {
          throw new Error(`Shortcut '${shortcut}' of action '${a.id}' is used by '${owner}'`);
        }
        own.set(canonical, shortcut);
      }
      for (const canonical of own.keys()) {
        byShortcut.set(canonical, [...(byShortcut.get(canonical) ?? []), a.id]);
      }
      byId.set(a.id, a);
      actions.set(Object.freeze([...actions.get(), toState(a)]));
      for (const source of [a.enabled, a.checked]) {
        if (source === undefined) continue;
        subscriptions.add(
          source.subscribe(() => {
            refresh([a.id]);
          }),
        );
      }
    },

    run: (id) => runAction(get(id)),

    handleKey(e) {
      if (e.inTextField) return false;
      const mode = modeOf();
      const ids = byShortcut.get(keyEventToShortcut(e.key, e.mods)) ?? [];
      // At most one: shortcuts are shared only between actions of disjoint modes.
      const action = ids.map(get).find((candidate) => modesOf(candidate).includes(mode));
      if (action === undefined) return false;
      runAction(action);
      return true;
    },

    dispose: () => {
      subscriptions.dispose();
    },
  };
}
