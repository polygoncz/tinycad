// Actions of the sketcher (spec 10, "Nástroje a akce skicáře"): finish, cancel, delete,
// construction and one action per geometric constraint over the selection of the sketch. They
// exist only in the mode 'sketch'; app registers them next to the built-in actions.

import { DisposableStore, ObservableValue } from '@/core';
import type { Disposable, IdGenerator, Observable } from '@/core';
import { GEOMETRIC_CONSTRAINT_KINDS, constraintFor } from '@/sketch';
import type {
  GeometricConstraintKind,
  SketchConstraint,
  SketchConstraintId,
  SketchEntity,
} from '@/sketch';
import type { ActionRegistry } from './actions';
import type { Mode } from './mode';
import type { SketchEditor } from './sketch-editor';
import type { SketchSession, SketchState } from './sketch-session';

export const SKETCH_ACTION_IDS = Object.freeze({
  finish: 'sketch.finish',
  cancel: 'sketch.cancel',
  delete: 'sketch.delete',
  construction: 'sketch.construction',
} as const);

/** 'sketch.constraint.<kind>'; also the translation key of its label. */
export function sketchConstraintActionId(kind: GeometricConstraintKind): string {
  return `sketch.constraint.${kind}`;
}

const SKETCH_ONLY: readonly Mode[] = Object.freeze(['sketch']);
const SKETCH_GROUP = 'sketch';
const CONSTRAINT_GROUP = 'sketch.constraint';
const CONSTRAINT_SHORTCUTS: Partial<Record<GeometricConstraintKind, string>> = {
  horizontal: 'H',
  vertical: 'V',
  coincident: 'I',
};

/**
 * Registers the sketcher actions into `deps.registry`. The returned Disposable unsubscribes the
 * `enabled` observables from the editor; the registry itself is disposed by its owner.
 */
export function createSketchActions(deps: {
  registry: ActionRegistry;
  sketches: SketchEditor;
  ids: IdGenerator;
}): Disposable {
  const { registry, sketches, ids } = deps;
  const subscriptions = new DisposableStore();
  const recomputes: (() => void)[] = [];
  let unsubscribeState = (): void => undefined;

  const session = (): SketchSession | null => sketches.current.get();
  const stateOf = (): SketchState | null => session()?.state.get() ?? null;

  /** The selected entities of the open session in selection order (constraints left out). */
  function selectedEntities(state: SketchState): readonly SketchEntity[] {
    const byId = new Map<string, SketchEntity>(state.entities.map((e) => [e.id, e]));
    return state.selection.flatMap((id) => {
      const entity = byId.get(id);
      return entity === undefined ? [] : [entity];
    });
  }

  /** enabled of an action: false without an open session, otherwise `test` of its state. */
  function enabledWhen(test: (state: SketchState) => boolean): Observable<boolean> {
    const compute = (): boolean => {
      const state = stateOf();
      return state !== null && state.open && test(state);
    };
    const value = new ObservableValue(compute());
    recomputes.push(() => {
      value.set(compute());
    });
    return value.asObservable();
  }

  const recomputeAll = (): void => {
    for (const recompute of recomputes) recompute();
  };

  // Follows the open session and its state.
  const follow = (): void => {
    unsubscribeState();
    unsubscribeState = session()?.state.subscribe(recomputeAll) ?? ((): void => undefined);
    recomputeAll();
  };
  subscriptions.add(sketches.current.subscribe(follow));
  subscriptions.add(() => {
    unsubscribeState();
  });

  const whileOpen = enabledWhen(() => true);

  registry.register({
    id: SKETCH_ACTION_IDS.finish,
    label: SKETCH_ACTION_IDS.finish,
    group: SKETCH_GROUP,
    modes: SKETCH_ONLY,
    // Not while a command waits for the solver: Finish would drop its result (D8).
    enabled: enabledWhen((state) => !state.busy),
    run: () => {
      session()?.finish();
    },
  });

  registry.register({
    id: SKETCH_ACTION_IDS.cancel,
    label: SKETCH_ACTION_IDS.cancel,
    group: SKETCH_GROUP,
    modes: SKETCH_ONLY,
    enabled: whileOpen,
    run: () => {
      session()?.cancel();
    },
  });

  registry.register({
    id: SKETCH_ACTION_IDS.delete,
    label: SKETCH_ACTION_IDS.delete,
    shortcut: ['Delete', 'Backspace'],
    modes: SKETCH_ONLY,
    enabled: enabledWhen((state) => state.selection.length > 0),
    run: () => {
      const s = session();
      if (s !== null) void s.remove(s.state.get().selection);
    },
  });

  registry.register({
    id: SKETCH_ACTION_IDS.construction,
    label: SKETCH_ACTION_IDS.construction,
    shortcut: 'Q',
    modes: SKETCH_ONLY,
    enabled: enabledWhen((state) => selectedEntities(state).some((e) => e.kind !== 'point')),
    run: () => {
      const s = session();
      if (s !== null) s.toggleConstruction(s.state.get().selection);
    },
  });

  for (const kind of GEOMETRIC_CONSTRAINT_KINDS) {
    const id = sketchConstraintActionId(kind);
    const shortcut = CONSTRAINT_SHORTCUTS[kind];
    registry.register({
      id,
      label: id,
      group: CONSTRAINT_GROUP,
      modes: SKETCH_ONLY,
      ...(shortcut === undefined ? {} : { shortcut }),
      enabled: enabledWhen((state) => constraintFor(kind, selectedEntities(state)) !== null),
      run: () => {
        const s = session();
        if (s === null) return;
        const draft = constraintFor(kind, selectedEntities(s.state.get()));
        if (draft === null) return;
        // Ids are minted here from the generator, the trusted place for a new constraint id.
        const constraint: SketchConstraint = { ...draft, id: ids.next() as SketchConstraintId };
        void s.addConstraint(constraint);
      },
    });
  }

  follow();
  return subscriptions;
}
