// The session of the sketcher (spec 10, "SketchEditor a SketchSession"): one open sketch feature.
// Every change goes through the solver and is written as feature.setParams of the feature session,
// so the whole editing stays one transaction (Q074). Commands run one after another in a queue;
// each reads the current data from the document when its turn comes.

import { ObservableValue, assert } from '@/core';
import type { Observable, Plane, Vec2 } from '@/core';
import { parseSketchData, removeItems, toggleConstruction } from '@/sketch';
import type {
  ConstraintSolver,
  SketchConstraint,
  SketchConstraintId,
  SketchData,
  SketchEntity,
  SketchEntityId,
  SketchItemId,
  SolveInput,
  SolveResult,
  SolveStatus,
} from '@/sketch';
import type { FeatureEditSession } from './feature-editor';
import { toSketchDrawing } from './sketch-drawing';
import type { SketchStyle, ViewportPort } from './viewport-port';

export interface SketchSession {
  readonly featureId: FeatureEditSession['featureId'];
  readonly plane: Plane;
  readonly state: Observable<SketchState>;
  /** New entities and constraints (tools); true = written. */
  addGeometry(add: SketchData): Promise<boolean>;
  /** Constraint actions, dimensions. */
  addConstraint(c: SketchConstraint): Promise<boolean>;
  setDimension(id: SketchConstraintId, value: number): Promise<boolean>;
  /** removeItems from sketch. */
  remove(ids: readonly SketchItemId[]): Promise<boolean>;
  /** Without the solver: construction does not change the solution. */
  toggleConstruction(ids: readonly SketchItemId[]): void;
  /** Dragging a point (the select tool). */
  drag(point: SketchEntityId, to: Vec2): void;
  /** Settles once the last drag target is solved. */
  endDrag(): Promise<void>;
  setHover(id: SketchItemId | null): void;
  /** Without additive = only this one; additive = toggle. */
  select(id: SketchItemId, opts?: { readonly additive?: boolean }): void;
  clearSelection(): void;
  clearEditingDimension(): void;
  /** FeatureEditSession.commit → one log entry. */
  finish(): void;
  /** FeatureEditSession.cancel → nothing. */
  cancel(): void;
}

export interface SketchState {
  readonly open: boolean;
  /** Name of the feature. */
  readonly name: string;
  /** From the params of the feature (parseSketchData; invalid data → []). */
  readonly entities: readonly SketchEntity[];
  readonly constraints: readonly SketchConstraint[];
  /** The last solution; 'solving' only before the first result. */
  readonly status: 'solving' | SolveStatus;
  readonly dof: number | null;
  /** status 'ok' && dof === 0 */
  readonly fullyDefined: boolean;
  /** In selection order, only existing items. */
  readonly selection: readonly SketchItemId[];
  readonly hover: SketchItemId | null;
  readonly message: { readonly key: SketchMessageKey } | null;
  /** For the panel. */
  readonly constraintRows: readonly SketchConstraintRow[];
  /** The dimension just created (ui focuses its field). */
  readonly editingDimension: SketchConstraintId | null;
}

export type SketchMessageKey = 'sketch.conflict' | 'sketch.redundant' | 'sketch.solverFailed';

export interface SketchConstraintRow {
  readonly id: SketchConstraintId;
  readonly kind: SketchConstraint['kind'];
  /** Order within its kind from 1 ("Horizontal 2"). */
  readonly n: number;
  /** Only distance and radius. */
  readonly value: number | null;
  readonly selected: boolean;
}

/** The id of the drawing of the edited sketch in ViewportPort.sketches. */
export const EDIT_SKETCH_DRAWING_ID = 'sketch-edit';

const EMPTY_DATA: SketchData = Object.freeze({
  entities: Object.freeze([]),
  constraints: Object.freeze([]),
});
const NO_ITEMS: readonly SketchItemId[] = Object.freeze([]);
const MESSAGES: { readonly [K in SketchMessageKey]: { readonly key: K } } = Object.freeze({
  'sketch.conflict': Object.freeze({ key: 'sketch.conflict' }),
  'sketch.redundant': Object.freeze({ key: 'sketch.redundant' }),
  'sketch.solverFailed': Object.freeze({ key: 'sketch.solverFailed' }),
});

type DimensionConstraint = Extract<SketchConstraint, { kind: 'distance' | 'radius' }>;

const isDimension = (c: SketchConstraint): c is DimensionConstraint =>
  c.kind === 'distance' || c.kind === 'radius';

/** Opened only by the SketchEditor, over a feature session of a sketch. */
export function openSketchSession(deps: {
  edit: FeatureEditSession;
  plane: Plane;
  solver: ConstraintSolver;
  viewport: ViewportPort;
  onClose: () => void;
}): SketchSession {
  const { edit, plane, solver, viewport, onClose } = deps;

  // The session's own state; the rest of SketchState comes from the feature session.
  let open = true;
  let status: SketchState['status'] = 'solving';
  let dof: number | null = null;
  let selection: readonly SketchItemId[] = NO_ITEMS;
  let hover: SketchItemId | null = null;
  let message: SketchState['message'] = null;
  let editingDimension: SketchConstraintId | null = null;

  const state = new ObservableValue<SketchState>(buildState(null));
  draw();
  const unsubscribeEdit = edit.state.subscribe(() => {
    if (!edit.state.get().open) close();
    else refresh();
  });

  // ---- state ----

  /** The data in the document; invalid data reads as empty. */
  function readData(): SketchData {
    const { params } = edit.state.get();
    const parsed = parseSketchData(params.entities, params.constraints);
    return parsed.ok ? parsed.value : EMPTY_DATA;
  }

  function buildState(prev: SketchState | null): SketchState {
    const data = readData();
    const entities =
      prev !== null && sameList(prev.entities, data.entities) ? prev.entities : data.entities;
    const constraints =
      prev !== null && sameList(prev.constraints, data.constraints)
        ? prev.constraints
        : data.constraints;
    // Prune what disappeared from the data, so a selection never names a missing item.
    const exists = new Set<string>([...entities.map((e) => e.id), ...constraints.map((c) => c.id)]);
    const kept = selection.filter((id) => exists.has(id));
    if (kept.length !== selection.length)
      selection = kept.length === 0 ? NO_ITEMS : Object.freeze(kept);
    if (hover !== null && !exists.has(hover)) hover = null;
    if (editingDimension !== null && !exists.has(editingDimension)) editingDimension = null;
    const rows = constraintRows(constraints, selection, prev?.constraintRows ?? []);
    return Object.freeze({
      open,
      name: edit.state.get().name,
      entities,
      constraints,
      status,
      dof,
      fullyDefined: status === 'ok' && dof === 0,
      selection: prev !== null && sameIds(prev.selection, selection) ? prev.selection : selection,
      hover,
      message,
      constraintRows: rows,
      editingDimension,
    });
  }

  /** Publishes a new snapshot unless nothing has changed, and redraws the sketch. */
  function refresh(): void {
    const prev = state.get();
    const next = buildState(prev);
    const keys = Object.keys(next) as (keyof SketchState)[]; // the keys of the snapshot just built
    if (keys.every((key) => Object.is(next[key], prev[key]))) return;
    state.set(next);
    if (open) draw();
  }

  function styleOf(id: SketchItemId, construction: boolean): SketchStyle {
    const s = state.get();
    if (s.selection.includes(id)) return 'selected';
    if (s.hover === id) return 'hover';
    if (construction) return 'construction';
    return s.fullyDefined ? 'defined' : 'normal';
  }

  function draw(): void {
    const s = state.get();
    const construction = new Set<string>(
      s.entities.flatMap((e) => (e.kind !== 'point' && e.construction === true ? [e.id] : [])),
    );
    viewport.sketches.set(
      EDIT_SKETCH_DRAWING_ID,
      toSketchDrawing(plane, s, (id) => styleOf(id, construction.has(id)), { origin: true }),
    );
  }

  function close(): void {
    if (!open) return;
    open = false;
    unsubscribeEdit();
    refresh();
    viewport.sketches.remove(EDIT_SKETCH_DRAWING_ID);
    onClose();
  }

  function checkOpen(what: string): void {
    assert(open, `${what}: the sketch session is closed`);
  }

  // ---- the queue ----

  let running = false;
  const waiting: (() => void)[] = [];

  /**
   * Runs the job after the ones before it; an idle queue starts it synchronously, so the solver
   * reads its input in the call of the command.
   */
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = (): void => {
        running = true;
        job()
          .then(resolve, reject)
          .finally(() => {
            const next = waiting.shift();
            if (next === undefined) running = false;
            else next();
          });
      };
      if (running) waiting.push(start);
      else start();
    });
  }

  /** Queued or running jobs that write a solution; a toggle of construction waits for them. */
  let writers = 0;

  /** A job that writes what it solved from the data it read at its start. */
  function enqueueWrite<T>(job: () => Promise<T>): Promise<T> {
    writers++;
    return enqueue(async () => {
      try {
        return await job();
      } finally {
        writers--;
      }
    });
  }

  /** The solver's answer, or null when it rejected (infrastructure failure). */
  async function solve(input: SolveInput): Promise<SolveResult | null> {
    try {
      return await solver.solve(input);
    } catch {
      return null;
    }
  }

  /** Writes the data unless it equals the current one; keeps unchanged arrays identical. */
  function write(data: SketchData): void {
    const cur = readData();
    const entities = sameList(cur.entities, data.entities) ? cur.entities : data.entities;
    const constraints = sameList(cur.constraints, data.constraints)
      ? cur.constraints
      : data.constraints;
    if (entities === cur.entities && constraints === cur.constraints) return;
    edit.setParams({ entities, constraints });
  }

  /**
   * Solves `build(current data)` and writes it on 'ok'. `rejectRedundant` = an added constraint
   * the solver calls redundant is refused; `dropRedundant` = such added constraints are left out.
   */
  function change(
    build: (data: SketchData) => SketchData,
    opts: {
      readonly rejectRedundant?: SketchConstraintId;
      readonly dropRedundant?: ReadonlySet<SketchConstraintId>;
      readonly onWritten?: () => void;
    } = {},
  ): Promise<boolean> {
    return enqueueWrite(async () => {
      const next = build(readData());
      const result = await solve(next);
      if (!open) return false;
      if (result === null || result.status === 'failed') return reject('sketch.solverFailed');
      if (result.status === 'conflict') return reject('sketch.conflict');
      const redundant = new Set(result.redundant);
      if (opts.rejectRedundant !== undefined && redundant.has(opts.rejectRedundant)) {
        return reject('sketch.redundant');
      }
      const drop = opts.dropRedundant;
      const constraints =
        drop === undefined
          ? next.constraints
          : next.constraints.filter((c) => !(drop.has(c.id) && redundant.has(c.id)));
      accept(result, { entities: result.entities ?? next.entities, constraints });
      opts.onWritten?.();
      refresh();
      return true;
    });
  }

  function reject(key: SketchMessageKey): false {
    message = MESSAGES[key];
    refresh();
    return false;
  }

  /** Writes an 'ok' result and takes over its status. */
  function accept(result: SolveResult, data: SketchData): void {
    write(freezeData(data));
    status = result.status;
    dof = result.dof;
    message = null;
  }

  // The first solve of the current data without writing (the log would get computation noise).
  void enqueue(async () => {
    const result = await solve(readData());
    if (!open) return;
    status = result === null ? 'failed' : result.status;
    dof = result === null ? null : result.dof;
    refresh();
  });

  // ---- dragging ----

  /** The waiting target; a new drag replaces it. */
  let dragTarget: { readonly point: SketchEntityId; readonly to: Vec2 } | null = null;
  /** A drag job is in the queue and has not taken its target yet. */
  let dragQueued = false;
  /** Settles when the last queued drag job is done. */
  let dragDone: Promise<void> = Promise.resolve();

  function dragJob(): Promise<void> {
    return enqueueWrite(async () => {
      dragQueued = false;
      const target = dragTarget;
      dragTarget = null;
      if (target === null) return;
      const data = readData();
      const result = await solve({ ...data, drag: target });
      // A conflict or a failure while dragging is dropped silently.
      if (!open || result === null || result.status !== 'ok') return;
      accept(result, { entities: result.entities ?? data.entities, constraints: data.constraints });
      refresh();
    });
  }

  // ---- commands ----

  return {
    featureId: edit.featureId,
    plane,
    state: state.asObservable(),
    addGeometry(add) {
      checkOpen('addGeometry');
      const added = new Set(add.constraints.map((c) => c.id));
      return change(
        (data) => ({
          entities: [...data.entities, ...add.entities],
          constraints: [...data.constraints, ...add.constraints],
        }),
        { dropRedundant: added },
      );
    },
    addConstraint(c) {
      checkOpen('addConstraint');
      return change(
        (data) => ({ entities: data.entities, constraints: [...data.constraints, c] }),
        {
          rejectRedundant: c.id,
          onWritten: () => {
            if (isDimension(c)) editingDimension = c.id;
          },
        },
      );
    },
    setDimension(id, value) {
      checkOpen('setDimension');
      const known = readData().constraints.some((c) => c.id === id && isDimension(c));
      if (!known || !Number.isFinite(value) || value <= 0) return Promise.resolve(false);
      return change((data) => ({
        entities: data.entities,
        constraints: data.constraints.map((c) =>
          c.id === id && isDimension(c) ? { ...c, value } : c,
        ),
      }));
    },
    remove(ids) {
      checkOpen('remove');
      return change((data) => removeItems(data, ids));
    },
    toggleConstruction(ids) {
      checkOpen('toggleConstruction');
      const apply = (): void => {
        const data = readData();
        const next = toggleConstruction(data, ids);
        if (next !== data) write(next);
      };
      // Written at once; behind a pending solve it waits its turn, or that solve's write would
      // undo it (the solve read the data before the toggle).
      if (writers === 0) apply();
      else
        void enqueue(() => {
          if (open) apply();
          return Promise.resolve();
        });
    },
    drag(point, to) {
      checkOpen('drag');
      dragTarget = Object.freeze({ point, to });
      if (dragQueued) return;
      dragQueued = true;
      dragDone = dragJob();
    },
    endDrag() {
      checkOpen('endDrag');
      return dragDone;
    },
    setHover(id) {
      checkOpen('setHover');
      if (id !== null && !itemExists(id)) return;
      hover = id;
      refresh();
    },
    select(id, opts = {}) {
      checkOpen('select');
      if (!itemExists(id)) return;
      if (opts.additive !== true) selection = Object.freeze([id]);
      else if (selection.includes(id)) selection = Object.freeze(selection.filter((s) => s !== id));
      else selection = Object.freeze([...selection, id]);
      refresh();
    },
    clearSelection() {
      checkOpen('clearSelection');
      selection = NO_ITEMS;
      refresh();
    },
    clearEditingDimension() {
      checkOpen('clearEditingDimension');
      editingDimension = null;
      refresh();
    },
    finish() {
      checkOpen('finish');
      edit.commit();
    },
    cancel() {
      checkOpen('cancel');
      edit.cancel();
    },
  };

  function itemExists(id: SketchItemId): boolean {
    const s = state.get();
    return s.entities.some((e) => e.id === id) || s.constraints.some((c) => c.id === id);
  }
}

/** The rows of the panel; an unchanged row stays the same object. */
function constraintRows(
  constraints: readonly SketchConstraint[],
  selection: readonly SketchItemId[],
  prev: readonly SketchConstraintRow[],
): readonly SketchConstraintRow[] {
  const counts = new Map<SketchConstraint['kind'], number>();
  const rows = constraints.map((c, i): SketchConstraintRow => {
    const n = (counts.get(c.kind) ?? 0) + 1;
    counts.set(c.kind, n);
    const row: SketchConstraintRow = {
      id: c.id,
      kind: c.kind,
      n,
      value: isDimension(c) ? c.value : null,
      selected: selection.includes(c.id),
    };
    const old = prev[i];
    return old !== undefined && sameRow(old, row) ? old : Object.freeze(row);
  });
  const unchanged = rows.length === prev.length && rows.every((row, i) => row === prev[i]);
  return unchanged ? prev : Object.freeze(rows);
}

function sameRow(a: SketchConstraintRow, b: SketchConstraintRow): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.n === b.n &&
    Object.is(a.value, b.value) &&
    a.selected === b.selected
  );
}

function sameIds(a: readonly SketchItemId[], b: readonly SketchItemId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Same items by value; sketch entities and constraints are flat objects of primitives. */
function sameList(a: readonly object[], b: readonly object[]): boolean {
  return a === b || (a.length === b.length && a.every((item, i) => sameFlat(item, b[i])));
}

function sameFlat(a: object, b: object | undefined): boolean {
  if (a === b) return true;
  if (b === undefined) return false;
  const own: readonly (readonly [string, unknown])[] = Object.entries(a);
  const other = new Map<string, unknown>(Object.entries(b));
  return (
    own.length === other.size &&
    own.every(([key, value]) => other.has(key) && Object.is(value, other.get(key)))
  );
}

/** Frozen arrays and items (the document freezes them too; frozen data is never shared mutable). */
function freezeData(data: SketchData): SketchData {
  return Object.freeze({
    entities: Object.freeze(data.entities.map((e) => Object.freeze(e))),
    constraints: Object.freeze(data.constraints.map((c) => Object.freeze(c))),
  });
}
