// The feature tree (spec 10, "Strom featur"): a presentation model over the document, the
// regeneration status port, the selection and the feature editor. The view only reads the
// snapshots and calls the commands; the whole tree logic is testable in Node without Vue.

import { ObservableValue, assert } from '@/core';
import type { Observable, RegistryReader, Unsubscribe } from '@/core';
import { dependenciesOf, orderViolations } from '@/document';
import type {
  DocumentReader,
  FeatureId,
  FeatureInstance,
  FeatureSchema,
  OrderViolation,
  ParamIssue,
  PartStudioData,
} from '@/document';
import type {
  FeatureMoveOp,
  FeatureRenameOp,
  OperationDispatcher,
  StudioSetRollbackOp,
} from '@/ops';
import { OP_VERSION } from '@/ops';
import { SKETCH_FEATURE_TYPE } from '@/sketch';
import type { FeatureEditor } from './feature-editor';
import type { FeatureHealth, RegenStatusPort } from './regen-status-port';
import type { SelectionCommands } from './selection';

export type TreeStatus = 'ok' | 'warning' | 'error' | 'suppressed' | 'rolledBack' | 'pending';

export interface TreeRow {
  readonly id: FeatureId;
  readonly name: string;
  readonly type: string;
  /** schema.label; an unknown type → type. */
  readonly typeLabel: string;
  /** schema.icon (a Tabler icon name); an unknown type or a schema without one → null. */
  readonly icon: string | null;
  /** Invalid params of a FeatureHealth error (INVALID_PARAMS), otherwise null; ui translates them. */
  readonly issues: readonly ParamIssue[] | null;
  readonly status: TreeStatus;
  /** For warning/error. */
  readonly message: string | null;
  /** The selection contains { kind: 'feature', feature: id }. */
  readonly selected: boolean;
  /** The feature of the open edit session. */
  readonly editing: boolean;
  /** How many features depend on this one (dependentsOf), for the tooltip (M11). */
  readonly dependents: number;
}

export interface FeatureTreeModel {
  readonly rows: Observable<readonly TreeRow[]>;
  readonly rollbackIndex: Observable<number>;
  /** → FeatureEditor.edit; a sketch → sketchEdit when given (M12). */
  edit(id: FeatureId): void;
  /** → dispatch feature.rename */
  rename(id: FeatureId, name: string): void;
  /** → dispatch studio.setRollback */
  moveRollbackBar(index: number): void;
  /** The feature in the rename mode (the inline field of the Timeline); null = none. */
  readonly renaming: Observable<FeatureId | null>;
  /** The action feature.rename: puts the feature into the rename mode. */
  beginRename(id: FeatureId): void;
  /** Ends the rename mode without renaming; rename() ends it too. */
  cancelRename(): void;
  /** → selection.set / toggle */
  select(id: FeatureId, opts?: { additive?: boolean }): void;
  /** The features outside ids that depend on any of ids; in studio order, without duplicates (M11). */
  dependentsOf(ids: readonly FeatureId[]): readonly FeatureId[];
  /**
   * Moves the feature to the final index toIndex (feature.move). Empty = moved; otherwise the
   * new order violations the move would bring, and nothing happened (M11).
   */
  move(id: FeatureId, toIndex: number): readonly OrderViolation[];
  dispose(): void;
}

export function createFeatureTreeModel(deps: {
  doc: DocumentReader;
  ops: OperationDispatcher;
  schemas: RegistryReader<FeatureSchema>;
  regen: RegenStatusPort;
  editor: Pick<FeatureEditor, 'current' | 'edit'>;
  selection: SelectionCommands;
  /** M12: a feature of type SKETCH_FEATURE_TYPE is edited here instead of FeatureEditor.edit. */
  sketchEdit?: (id: FeatureId) => void;
}): FeatureTreeModel {
  const { doc, ops, schemas, regen, editor, selection, sketchEdit } = deps;

  /** The dependency graph of `graphOf`; recomputed only when the studio changes. */
  let graphOf: PartStudioData | null = null;
  let graph: ReadonlyMap<FeatureId, readonly FeatureId[]> = new Map();
  function dependencies(): ReadonlyMap<FeatureId, readonly FeatureId[]> {
    // The studio is immutable: the same object means the same references.
    if (graphOf !== doc.studio) {
      graphOf = doc.studio;
      graph = dependenciesOf(graphOf, schemas);
    }
    return graph;
  }

  const rows = new ObservableValue<readonly TreeRow[]>(buildRows([]));
  const rollbackIndex = new ObservableValue<number>(doc.studio.rollbackIndex);
  const renaming = new ObservableValue<FeatureId | null>(null);

  /** The rows from all sources, reusing every unchanged row of `prev`. */
  function buildRows(prev: readonly TreeRow[]): readonly TreeRow[] {
    const { features, rollbackIndex: bar } = doc.studio;
    const health = regen.state.get().health;
    const selected = new Set(
      selection.items.get().flatMap((item) => (item.kind === 'feature' ? [item.feature] : [])),
    );
    const editing = editor.current.get()?.featureId ?? null;
    const dependents = countDependents(dependencies());

    const next = features.map((feature, i): TreeRow => {
      const { status, message, issues } = statusOf(feature, i >= bar, health.get(feature.id));
      const schema = schemas.find(feature.type);
      const row: TreeRow = {
        id: feature.id,
        name: feature.name,
        type: feature.type,
        typeLabel: schema?.label ?? feature.type,
        icon: schema?.icon ?? null,
        issues,
        status,
        message,
        selected: selected.has(feature.id),
        editing: feature.id === editing,
        dependents: dependents.get(feature.id) ?? 0,
      };
      // Rows are matched by position: a row only moves when features move, which is rare.
      const old = prev[i];
      return old !== undefined && sameRow(old, row) ? old : Object.freeze(row);
    });
    const unchanged = prev.length === next.length && next.every((row, i) => row === prev[i]);
    return unchanged ? prev : Object.freeze(next);
  }

  function refresh(): void {
    rows.set(buildRows(rows.get()));
    rollbackIndex.set(doc.studio.rollbackIndex);
  }

  const unsubscribes: readonly Unsubscribe[] = [
    doc.events.on('changed', refresh),
    regen.state.subscribe(refresh),
    selection.items.subscribe(refresh),
    editor.current.subscribe(refresh),
  ];

  return {
    rows: rows.asObservable(),
    rollbackIndex: rollbackIndex.asObservable(),
    edit(id) {
      // A sketch has no feature dialog: the sketcher opens it (spec 12, "Skicář").
      if (sketchEdit !== undefined && doc.feature(id)?.type === SKETCH_FEATURE_TYPE) {
        sketchEdit(id);
        return;
      }
      editor.edit(id);
    },
    rename(id, name) {
      // The inline field is done whatever happens to the name.
      renaming.set(null);
      const feature = doc.feature(id);
      assert(feature !== undefined, `rename: unknown feature '${id}'`);
      const trimmed = name.trim();
      if (trimmed === '' || trimmed === feature.name) return;
      const op: FeatureRenameOp = {
        type: 'feature.rename',
        v: OP_VERSION['feature.rename'],
        featureId: id,
        name: trimmed,
      };
      ops.dispatch(op);
    },
    moveRollbackBar(index) {
      const { features, rollbackIndex: bar } = doc.studio;
      if (index === bar) return;
      assert(
        Number.isInteger(index) && index >= 0 && index <= features.length,
        `moveRollbackBar: index ${String(index)} is out of 0..${String(features.length)}`,
      );
      const op: StudioSetRollbackOp = {
        type: 'studio.setRollback',
        v: OP_VERSION['studio.setRollback'],
        index,
      };
      ops.dispatch(op);
    },
    renaming: renaming.asObservable(),
    beginRename(id) {
      assert(doc.feature(id) !== undefined, `beginRename: unknown feature '${id}'`);
      renaming.set(id);
    },
    cancelRename() {
      renaming.set(null);
    },
    select(id, opts) {
      const item = { kind: 'feature', feature: id } as const;
      if (opts?.additive === true) selection.toggle(item);
      else selection.set([item]);
    },
    dependentsOf(ids) {
      const of = new Set(ids);
      const found: FeatureId[] = [];
      // The map is in studio order and has each feature once.
      for (const [feature, dependsOn] of dependencies()) {
        if (!of.has(feature) && dependsOn.some((d) => of.has(d))) found.push(feature);
      }
      return Object.freeze(found);
    },
    move(id, toIndex) {
      const studio = doc.studio;
      const { features } = studio;
      const from = features.findIndex((f) => f.id === id);
      const feature = features[from];
      assert(feature !== undefined, `move: unknown feature '${id}'`);
      assert(
        Number.isInteger(toIndex) && toIndex >= 0 && toIndex < features.length,
        `move: index ${String(toIndex)} is out of 0..${String(features.length - 1)}`,
      );
      if (toIndex === from) return Object.freeze([]);
      // The references do not depend on the order, so the graph stays valid for the new order.
      const deps = dependencies();
      const moved = features.toSpliced(from, 1).toSpliced(toIndex, 0, feature);
      const existing = new Set(orderViolations(studio, deps).map(violationKey));
      const added = orderViolations({ ...studio, features: moved }, deps).filter(
        (v) => !existing.has(violationKey(v)),
      );
      if (added.length > 0) return Object.freeze(added);
      const op: FeatureMoveOp = {
        type: 'feature.move',
        v: OP_VERSION['feature.move'],
        featureId: id,
        toIndex,
      };
      ops.dispatch(op);
      return Object.freeze([]);
    },
    dispose() {
      for (const unsubscribe of unsubscribes) unsubscribe();
    },
  };
}

/** Per feature, how many features depend on it. */
function countDependents(
  deps: ReadonlyMap<FeatureId, readonly FeatureId[]>,
): ReadonlyMap<FeatureId, number> {
  const counts = new Map<FeatureId, number>();
  // dependenciesOf lists each dependency of a feature once, so each dependent counts once.
  for (const dependsOn of deps.values()) {
    for (const d of dependsOn) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return counts;
}

/** Identity of an order violation for comparing two lists. */
function violationKey(v: OrderViolation): string {
  return JSON.stringify([v.feature, v.dependsOn]);
}

interface RowStatus {
  readonly status: TreeStatus;
  readonly message: string | null;
  readonly issues: readonly ParamIssue[] | null;
}

/**
 * suppressed > rolledBack > health from the port > pending (not evaluated yet). Message and
 * issues only come with the status that shows them, never from a stale health.
 */
function statusOf(
  feature: FeatureInstance,
  rolledBack: boolean,
  health: FeatureHealth | undefined,
): RowStatus {
  if (feature.suppressed) return { status: 'suppressed', message: null, issues: null };
  if (rolledBack) return { status: 'rolledBack', message: null, issues: null };
  if (health === undefined) return { status: 'pending', message: null, issues: null };
  if (health.kind === 'ok') return { status: 'ok', message: null, issues: null };
  if (health.kind === 'warning') {
    return { status: 'warning', message: health.message, issues: null };
  }
  return { status: 'error', message: health.message, issues: health.issues ?? null };
}

function sameRow(a: TreeRow, b: TreeRow): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.type === b.type &&
    a.typeLabel === b.typeLabel &&
    a.icon === b.icon &&
    sameIssues(a.issues, b.issues) &&
    a.status === b.status &&
    a.message === b.message &&
    a.selected === b.selected &&
    a.editing === b.editing &&
    a.dependents === b.dependents
  );
}

/** Every regeneration brings new issue objects, so equal issues compare by value. */
function sameIssues(a: readonly ParamIssue[] | null, b: readonly ParamIssue[] | null): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.length !== b.length) return false;
  return a.every((issue, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      issue.param === other.param &&
      issue.code === other.code &&
      sameParams(issue.params, other.params)
    );
  });
}

function sameParams(a: ParamIssue['params'], b: ParamIssue['params']): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}
