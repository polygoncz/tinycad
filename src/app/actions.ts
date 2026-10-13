// Built-in actions (spec 10, "Akce a klávesové zkratky"; M10 plan, Ú7): undo, redo, delete and
// suppress of the selected features, fit all, the rollback bar steps of the timeline and one
// action per tool with a shortcut. Labels are translation keys (ADR 0014); ui translates them.

import { DisposableStore, ObservableValue } from '@/core';
import type { Disposable, Observable, Unsubscribe } from '@/core';
import type { DocumentReader, FeatureId } from '@/document';
import type {
  ActionRegistry,
  FeatureEditor,
  FeatureTreeModel,
  SelectionModel,
  ToolDescriptor,
  ToolManager,
} from '@/interaction';
import { OP_VERSION } from '@/ops';
import type {
  FeatureRemoveOp,
  FeatureSuppressOp,
  Operation,
  OperationDispatcher,
  UndoManager,
} from '@/ops';
import type { CameraController } from '@/render';

export interface BuiltInActionDeps {
  readonly actions: ActionRegistry;
  readonly doc: DocumentReader;
  /** The dispatcher of the session (the refusing one when read-only). */
  readonly ops: OperationDispatcher;
  readonly undo: UndoManager;
  readonly selection: SelectionModel;
  readonly features: FeatureEditor;
  readonly featureTree: FeatureTreeModel;
  readonly tools: ToolManager;
  readonly toolList: readonly ToolDescriptor[];
  readonly camera: CameraController;
  readonly readOnly: boolean;
}

/**
 * Registers the built-in actions into `deps.actions`. The returned Disposable unsubscribes the
 * `enabled` observables from their sources; the registry itself is disposed by its owner.
 */
export function registerBuiltInActions(deps: BuiltInActionDeps): Disposable {
  const { actions, doc, ops, undo, selection, features, featureTree, tools, camera } = deps;
  const subscriptions = new DisposableStore();

  /** An Observable<boolean> recomputed whenever one of the sources fires. */
  function derived(
    compute: () => boolean,
    sources: readonly ((fn: () => void) => Unsubscribe)[],
  ): Observable<boolean> {
    const value = new ObservableValue(compute());
    const recompute = (): void => {
      value.set(compute());
    };
    for (const source of sources) subscriptions.add(source(recompute));
    return value.asObservable();
  }

  // Sources of `enabled`.
  const onSession = (fn: () => void): Unsubscribe => features.current.subscribe(fn);
  const onDoc = (fn: () => void): Unsubscribe => doc.events.on('changed', fn);
  const onSelection = (fn: () => void): Unsubscribe => selection.items.subscribe(fn);
  const onUndo = (fn: () => void): Unsubscribe => undo.events.on('changed', fn);

  /** Read-only, or the feature dialog holds a transaction: nothing may change the document. */
  const blocked = (): boolean => deps.readOnly || features.current.get() !== null;

  /** Selected features that still exist, in selection order. */
  function selectedFeatures(): FeatureId[] {
    return selection.items
      .get()
      .flatMap((item) => (item.kind === 'feature' ? [item.feature] : []))
      .filter((id) => doc.feature(id) !== undefined);
  }

  /** All ops in one transaction, so the action is one undo step. */
  function applyAll(label: string, list: readonly Operation[]): void {
    if (list.length === 0) return;
    const tx = ops.begin(label);
    try {
      for (const op of list) tx.apply(op);
    } catch (e) {
      tx.abort();
      throw e;
    }
    tx.commit();
  }

  actions.register({
    id: 'undo',
    label: 'undo',
    shortcut: 'Mod+Z',
    enabled: derived(() => !blocked() && undo.canUndo(), [onUndo, onSession]),
    run: () => {
      undo.undo();
    },
  });

  actions.register({
    id: 'redo',
    label: 'redo',
    shortcut: 'Mod+Shift+Z',
    enabled: derived(() => !blocked() && undo.canRedo(), [onUndo, onSession]),
    run: () => {
      undo.redo();
    },
  });

  const hasSelectedFeature = (): boolean => !blocked() && selectedFeatures().length > 0;

  actions.register({
    id: 'feature.delete',
    label: 'feature.delete',
    shortcut: 'Delete',
    enabled: derived(hasSelectedFeature, [onSelection, onDoc, onSession]),
    run: () => {
      const removed = new Set(selectedFeatures());
      applyAll(
        'feature.delete',
        [...removed].map((featureId): FeatureRemoveOp => ({
          type: 'feature.remove',
          v: OP_VERSION['feature.remove'],
          featureId,
        })),
      );
      // A deleted feature does not stay selected (undo brings it back unselected).
      selection.set(
        selection.items.get().filter((i) => i.kind !== 'feature' || !removed.has(i.feature)),
      );
    },
  });

  actions.register({
    id: 'feature.suppress',
    label: 'feature.suppress',
    shortcut: 'S',
    enabled: derived(hasSelectedFeature, [onSelection, onDoc, onSession]),
    run: () => {
      const selected = selectedFeatures();
      // All suppressed → unsuppress all; otherwise suppress the rest.
      const suppressed = !selected.every((id) => doc.feature(id)?.suppressed === true);
      applyAll(
        'feature.suppress',
        selected
          .filter((id) => doc.feature(id)?.suppressed !== suppressed)
          .map((featureId): FeatureSuppressOp => ({
            type: 'feature.suppress',
            v: OP_VERSION['feature.suppress'],
            featureId,
            suppressed,
          })),
      );
    },
  });

  actions.register({
    id: 'view.fitAll',
    label: 'view.fitAll',
    shortcut: 'F',
    // Does not change the document: enabled also read-only and with the dialog open.
    enabled: new ObservableValue(true).asObservable(),
    run: () => {
      camera.fitAll();
    },
  });

  // Rollback bar steps; target() of the action is null when the step leads nowhere.
  const barSteps: readonly { id: string; target: () => number }[] = [
    { id: 'timeline.toStart', target: () => 0 },
    { id: 'timeline.stepBack', target: () => doc.studio.rollbackIndex - 1 },
    { id: 'timeline.stepForward', target: () => doc.studio.rollbackIndex + 1 },
    { id: 'timeline.toEnd', target: () => doc.studio.features.length },
  ];
  for (const step of barSteps) {
    const target = (): number | null => {
      const index = step.target();
      const { features: list, rollbackIndex } = doc.studio;
      return index >= 0 && index <= list.length && index !== rollbackIndex ? index : null;
    };
    actions.register({
      id: step.id,
      label: step.id,
      enabled: derived(() => !blocked() && target() !== null, [onDoc, onSession]),
      run: () => {
        const index = target();
        if (index !== null) featureTree.moveRollbackBar(index);
      },
    });
  }

  // Tools with a shortcut; a tool without one is reachable only from the toolbar.
  const toolEnabled = derived(() => !blocked(), [onSession]);
  for (const tool of deps.toolList) {
    if (tool.shortcut === undefined) continue;
    actions.register({
      id: `tool.${tool.id}`,
      label: tool.label,
      shortcut: tool.shortcut,
      enabled: toolEnabled,
      run: () => {
        tools.activate(tool.id);
      },
    });
  }

  return subscriptions;
}
