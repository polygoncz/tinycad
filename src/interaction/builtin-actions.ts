// Built-in actions (spec 10, "Vestavěné akce"): undo, redo, edit, rename, suppress and delete of
// the selected features, the bar after the selected feature, fit all, the rollback bar steps of
// the timeline and one action per tool with a shortcut. Their rules are presentation logic
// (ADR 0010), so they live here and app only calls createBuiltInActions. Labels are translation
// keys (ADR 0014); ui translates them. Feature and timeline actions exist only in the mode
// 'model'; a tool action exists in the modes of its tool (M12).

import { DisposableStore, ObservableValue } from '@/core';
import type { Disposable, Observable, Unsubscribe } from '@/core';
import type { DocumentReader, FeatureId } from '@/document';
import { OP_VERSION } from '@/ops';
import type {
  FeatureRemoveOp,
  FeatureSuppressOp,
  Operation,
  OperationDispatcher,
  UndoManager,
} from '@/ops';
import type { ActionRegistry } from './actions';
import type { FeatureTreeModel } from './feature-tree';
import type { Mode } from './mode';
import type { SelectionModel } from './selection';
import type { ToolManager } from './tool-manager';
import { toolModes } from './tools';
import type { ToolDescriptor } from './tools';

/** Ids of the built-in actions; ui takes them from AppSession.actionIds, never as literals. */
export const ACTION_IDS = Object.freeze({
  undo: 'undo',
  redo: 'redo',
  fitAll: 'view.fitAll',
  featureEdit: 'feature.edit',
  featureRename: 'feature.rename',
  featureSuppress: 'feature.suppress',
  featureDelete: 'feature.delete',
  rollHere: 'timeline.rollHere',
  toStart: 'timeline.toStart',
  stepBack: 'timeline.stepBack',
  stepForward: 'timeline.stepForward',
  toEnd: 'timeline.toEnd',
} as const);

/**
 * A yes/no question for the user: a translation key and its params. interaction knows no DOM,
 * so the dialog comes from ui through app.
 */
export interface ConfirmRequest {
  readonly key: string;
  readonly params: Readonly<Record<string, string | number>>;
}

/** The action that activates a tool with a shortcut. */
export function toolActionId(toolId: string): string {
  return `tool.${toolId}`;
}

/** The group of the feature context menu in the Timeline. */
const FEATURE_GROUP = 'feature';

/** Modes of the actions that edit the studio: not inside the sketcher. */
const MODEL_ONLY: readonly Mode[] = Object.freeze(['model']);

/**
 * Registers the built-in actions into `deps.registry`. The returned Disposable unsubscribes the
 * `enabled` observables from their sources; the registry itself is disposed by its owner.
 */
export function createBuiltInActions(deps: {
  registry: ActionRegistry;
  doc: DocumentReader;
  /** The dispatcher of the session (the refusing one when read-only). */
  ops: OperationDispatcher;
  undo: UndoManager;
  selection: SelectionModel;
  featureTree: FeatureTreeModel;
  tools: ToolManager;
  toolList: readonly ToolDescriptor[];
  /** createEditLock: read-only or an open feature dialog. */
  locked: Observable<boolean>;
  /** Narrow on purpose: interaction does not know render. */
  camera: { fitAll(): void };
  /** Asks the user; true = go on. feature.delete asks before features lose a reference. */
  confirm: (request: ConfirmRequest) => boolean;
  /** The current mode (M12); without it the mode is always 'model'. */
  mode?: Observable<Mode>;
}): Disposable {
  const { registry, doc, ops, undo, selection, featureTree, tools, locked, camera } = deps;
  const { confirm } = deps;
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
  const onLock = (fn: () => void): Unsubscribe => locked.subscribe(fn);
  const onDoc = (fn: () => void): Unsubscribe => doc.events.on('changed', fn);
  const onSelection = (fn: () => void): Unsubscribe => selection.items.subscribe(fn);
  const onUndo = (fn: () => void): Unsubscribe => undo.events.on('changed', fn);
  const onFeatures = [onSelection, onDoc, onLock];

  const isLocked = (): boolean => locked.get();

  /** Selected features that still exist, in selection order. */
  function selectedFeatures(): FeatureId[] {
    return selection.items
      .get()
      .flatMap((item) => (item.kind === 'feature' ? [item.feature] : []))
      .filter((id) => doc.feature(id) !== undefined);
  }

  /** The one selected feature; null with none or more than one selected. */
  function singleSelected(): FeatureId | null {
    const selected = selectedFeatures();
    return selected.length === 1 ? (selected[0] ?? null) : null;
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

  registry.register({
    id: ACTION_IDS.undo,
    label: ACTION_IDS.undo,
    shortcut: 'Mod+Z',
    enabled: derived(() => !isLocked() && undo.canUndo(), [onUndo, onLock]),
    run: () => {
      undo.undo();
    },
  });

  registry.register({
    id: ACTION_IDS.redo,
    label: ACTION_IDS.redo,
    shortcut: 'Mod+Shift+Z',
    enabled: derived(() => !isLocked() && undo.canRedo(), [onUndo, onLock]),
    run: () => {
      undo.redo();
    },
  });

  const hasSelectedFeature = (): boolean => !isLocked() && selectedFeatures().length > 0;
  const hasSingleSelected = (): boolean => !isLocked() && singleSelected() !== null;

  // The feature context menu of the timeline is the group 'feature' in registration order:
  // edit, rename, suppress, roll here, delete.
  registry.register({
    id: ACTION_IDS.featureEdit,
    label: ACTION_IDS.featureEdit,
    modes: MODEL_ONLY,
    group: FEATURE_GROUP,
    enabled: derived(hasSingleSelected, onFeatures),
    run: () => {
      const id = singleSelected();
      // Through the tree, so a sketch opens in the sketcher, not in the feature dialog.
      if (id !== null) featureTree.edit(id);
    },
  });

  registry.register({
    id: ACTION_IDS.featureRename,
    label: ACTION_IDS.featureRename,
    modes: MODEL_ONLY,
    group: FEATURE_GROUP,
    enabled: derived(hasSingleSelected, onFeatures),
    run: () => {
      const id = singleSelected();
      if (id !== null) featureTree.beginRename(id);
    },
  });

  registry.register({
    id: ACTION_IDS.featureSuppress,
    label: ACTION_IDS.featureSuppress,
    modes: MODEL_ONLY,
    shortcut: 'S',
    group: FEATURE_GROUP,
    enabled: derived(hasSelectedFeature, onFeatures),
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

  /** The bar right after the one selected feature; null when there is none or the bar is there. */
  const rollHereTarget = (): number | null => {
    const id = singleSelected();
    if (id === null) return null;
    const index = doc.studio.features.findIndex((f) => f.id === id) + 1;
    return index === doc.studio.rollbackIndex ? null : index;
  };
  registry.register({
    id: ACTION_IDS.rollHere,
    label: ACTION_IDS.rollHere,
    modes: MODEL_ONLY,
    group: FEATURE_GROUP,
    enabled: derived(() => !isLocked() && rollHereTarget() !== null, onFeatures),
    run: () => {
      const index = rollHereTarget();
      if (index !== null) featureTree.moveRollbackBar(index);
    },
  });

  registry.register({
    id: ACTION_IDS.featureDelete,
    label: ACTION_IDS.featureDelete,
    modes: MODEL_ONLY,
    shortcut: ['Delete', 'Backspace'],
    group: FEATURE_GROUP,
    enabled: derived(hasSelectedFeature, onFeatures),
    run: () => {
      const removed = new Set(selectedFeatures());
      // Features that would lose a reference (like Fusion): ask first, false changes nothing.
      const n = featureTree.dependentsOf([...removed]).length;
      if (n > 0 && !confirm({ key: 'feature.delete.confirm', params: { n } })) return;
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

  registry.register({
    id: ACTION_IDS.fitAll,
    label: ACTION_IDS.fitAll,
    shortcut: 'F',
    // Does not change the document: enabled also read-only and with the dialog open.
    enabled: new ObservableValue(true).asObservable(),
    run: () => {
      camera.fitAll();
    },
  });

  // Rollback bar steps; target() of the action is null when the step leads nowhere.
  const barSteps: readonly { id: string; target: () => number }[] = [
    { id: ACTION_IDS.toStart, target: () => 0 },
    { id: ACTION_IDS.stepBack, target: () => doc.studio.rollbackIndex - 1 },
    { id: ACTION_IDS.stepForward, target: () => doc.studio.rollbackIndex + 1 },
    { id: ACTION_IDS.toEnd, target: () => doc.studio.features.length },
  ];
  for (const step of barSteps) {
    const target = (): number | null => {
      const index = step.target();
      const { features: list, rollbackIndex } = doc.studio;
      return index >= 0 && index <= list.length && index !== rollbackIndex ? index : null;
    };
    registry.register({
      id: step.id,
      label: step.id,
      modes: MODEL_ONLY,
      enabled: derived(() => !isLocked() && target() !== null, [onDoc, onLock]),
      run: () => {
        const index = target();
        if (index !== null) featureTree.moveRollbackBar(index);
      },
    });
  }

  // Tools with a shortcut; a tool without one is reachable only from the toolbar. The sketcher
  // is an open feature edit (locked), so in the mode 'sketch' the lock does not count.
  const modeOf = (): Mode => deps.mode?.get() ?? 'model';
  const onMode = (fn: () => void): Unsubscribe => deps.mode?.subscribe(fn) ?? (() => undefined);
  for (const tool of deps.toolList) {
    if (tool.shortcut === undefined) continue;
    const modes = toolModes(tool);
    const enabled = (): boolean => {
      const mode = modeOf();
      return modes.includes(mode) && (mode === 'sketch' || !isLocked());
    };
    registry.register({
      id: toolActionId(tool.id),
      label: tool.label,
      shortcut: tool.shortcut,
      modes,
      enabled: derived(enabled, [onLock, onMode]),
      run: () => {
        tools.activate(tool.id);
      },
    });
  }

  return subscriptions;
}
