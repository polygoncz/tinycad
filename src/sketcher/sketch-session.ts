// The session of the sketcher (spec 10, "SketchEditor a SketchSession"): one open sketch feature.
// Every change goes through the solver and is written as feature.setParams of the feature session,
// so the whole editing stays one transaction (Q074). Commands run one after another in a queue;
// each reads the current data from the document when its turn comes.

import { ObservableValue, assert, plane as planeMath } from '@/core';
import type { Observable, Plane, Vec2, Vec3 } from '@/core';
import {
  SKETCH_PARAM,
  constraintTargets,
  curvePoints,
  isDimension,
  isPattern,
  movePlacement,
  parseSketchData,
  removeItems,
  toggleConstruction,
} from '@/sketch';
import type {
  ConstraintSolver,
  DimensionConstraint,
  DimensionPlacement,
  SketchConstraint,
  SketchConstraintDraft,
  SketchConstraintId,
  SketchData,
  SketchEntity,
  SketchEntityId,
  SketchGeometry,
  SketchItemId,
  SnapGuide,
  SolveInput,
  SolveResult,
  SolveStatus,
} from '@/sketch';
import { samePlaneRef } from '@/document';
import type { PlaneRef, TopoRef } from '@/document';
import type {
  EditState,
  FeatureEditSession,
  OverlayShape,
  RefText,
  SketchStyle,
  ViewportPort,
} from '@/interaction';
import { planeRefOf } from './plane-ref';
import { constraintNumbers, dimensionViews } from './sketch-dimensions';
import type { SketchDimensionView } from './sketch-dimensions';
import { toSketchDrawing } from './sketch-drawing';
import { patternDimensionViews, withPatternParam } from './sketch-pattern-dimensions';
import type { PatternParam, SketchPatternDimensionView } from './sketch-pattern-dimensions';
import { glyphViews, isGlyphConstraint } from './sketch-glyphs';
import type { GlyphKind, SketchGlyphView } from './sketch-glyphs';

export interface SketchSession {
  readonly featureId: FeatureEditSession['featureId'];
  /**
   * The plane of the sketch (M21): follows the param SKETCH_PARAM.plane while the session is
   * open; the entities keep their 2D coordinates on the new plane.
   */
  readonly plane: Observable<Plane>;
  readonly state: Observable<SketchState>;
  /**
   * New entities and constraints (tools); true = written. The constraints are automatic (M26): a
   * conflict solves again without the conflicting ones, then with only fix and `required`; at most
   * three solves. Added constraints the solver finds redundant are left out.
   */
  addGeometry(
    add: SketchData,
    opts?: { readonly required?: ReadonlySet<SketchConstraintId> },
  ): Promise<boolean>;
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
  /**
   * The dimension hanging on the cursor of the dimension tool (M28), or null for none: shown in
   * SketchState.dimensions as the view '__preview'; neither solved nor written. Writing a
   * dimension (addConstraint) clears it.
   */
  previewDimension(draft: SketchConstraintDraft | null): void;
  /**
   * Dragging the label of a dimension (M28) to px x, y of the view area: the new placement
   * (movePlacement) is only held in the session (SketchState.constraints and dimensions show it),
   * without the solver and without writing.
   */
  moveDimension(id: SketchConstraintId, x: number, y: number): void;
  /** Writes the placement of the dragged dimension in one setParams; without a move nothing. */
  endMoveDimension(): void;
  /**
   * A new parameter of a pattern (M36, a label of SketchState.patternDimensions) in one setParams
   * without the solver, queued like toggleConstruction. An invalid value, a parameter the pattern
   * does not have or an id that is no pattern → false and nothing written.
   */
  setPatternParam(pattern: SketchEntityId, param: PatternParam, value: number): boolean;
  /**
   * The constraints a click of a drawing tool would add at `at` (M26), or null for none: shown as
   * SketchState.inference; the guides are drawn into the overlay SKETCH_GUIDES_OVERLAY_ID. Neither
   * solved nor written.
   */
  setInferencePreview(p: InferencePreview | null): void;
  /** M31: SketchState.constructionMode; without the solver and without writing, only the session's state. */
  setConstructionMode(on: boolean): void;
  setHover(id: SketchItemId | null): void;
  /** Without additive = only this one; additive = toggle. */
  select(id: SketchItemId, opts?: { readonly additive?: boolean }): void;
  clearSelection(): void;
  clearEditingDimension(): void;
  /**
   * The field "Plane" of the panel (M21, Q076): focuses the plane param, so refPick covers the
   * tools of the sketcher and a plane is picked in the view or the Browser; a picked plane ends
   * it (interaction). Without a visible plane param nothing.
   */
  pickPlane(): void;
  /** Ends picking the plane (Esc on the field); true = it was picking, false = nothing to end. */
  cancelPlanePick(): boolean;
  /** FeatureEditSession.commit → one log entry. */
  finish(): void;
  /** FeatureEditSession.cancel → nothing. */
  cancel(): void;
}

export interface SketchState {
  readonly open: boolean;
  /**
   * A job that may write to the sketch is running or waiting in the queue: a solve with a result
   * to write, a drag, a deferred toggle of construction. Not the first solve after opening, which
   * writes nothing. Finish waits for false (D8); false once closed.
   */
  readonly busy: boolean;
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
  /**
   * The status line of the panel, a translation key: 'sketch.status.solving' | 'sketch.conflict'
   * | 'sketch.solverFailed' | 'sketch.status.defined' | 'sketch.status.dof'; ui only translates.
   */
  readonly statusKey: string;
  /** The params of statusKey ({ n: dof } for 'sketch.status.dof', otherwise {}). */
  readonly statusParams: Readonly<Record<string, number>>;
  /** In selection order, only existing items. */
  readonly selection: readonly SketchItemId[];
  readonly hover: SketchItemId | null;
  readonly message: { readonly key: SketchMessageKey } | null;
  /** For the panel. */
  readonly constraintRows: readonly SketchConstraintRow[];
  /** The dimension just created (ui focuses its field). */
  readonly editingDimension: SketchConstraintId | null;
  /** The dimensions for the viewport, then the preview of the dimension tool (dimensionViews, M28). */
  readonly dimensions: readonly SketchDimensionView[];
  /**
   * The dimensions of the parameters of the selected patterns for the viewport, in selection
   * order (patternDimensionViews, M36); a mirror has none.
   */
  readonly patternDimensions: readonly SketchPatternDimensionView[];
  /**
   * The glyphs of the geometric constraints for the viewport (glyphViews, M25): those of the
   * selected and hovered entities and of the entities of a selected or hovered constraint; all of
   * them with SketchEditor.showAllConstraints.
   */
  readonly glyphs: readonly SketchGlyphView[];
  /**
   * The constraints a click of the drawing tool would add (setInferencePreview, M26): their kinds
   * and the anchor in world coordinates; null without a preview or when it has no kinds.
   */
  readonly inference: { readonly anchor: Vec3; readonly kinds: readonly GlyphKind[] } | null;
  /** The field "Plane" of the panel (M21); null without a visible plane param. */
  readonly planeField: SketchPlaneField | null;
  /**
   * The plane of the sketch could not be computed on opening (Q079): the sketch is open on the
   * origin plane XY and the panel asks for a new plane. A picked plane that resolves clears it.
   */
  readonly planeMissing: boolean;
  /**
   * M31: the new curves of the drawing tools are construction (addDrawn). Default false, false on
   * opening the session.
   */
  readonly constructionMode: boolean;
}

/** The preview of the inferred constraints of a drawing tool (M26): in plane coordinates. */
export interface InferencePreview {
  readonly at: Vec2;
  readonly kinds: readonly GlyphKind[];
  readonly guides: readonly SnapGuide[];
}

/** The field "Plane" of the sketch panel (M21, Q076): the plane param of the feature session. */
export interface SketchPlaneField {
  /** The translation key of the label (the schema of the sketch). */
  readonly label: string;
  /** The text of the plane from interaction (FieldState.refText); null = nothing selected. */
  readonly text: RefText | null;
  /** Picking the plane: refPick covers the tools of the sketcher. */
  readonly active: boolean;
  /** The param has an issue. */
  readonly invalid: boolean;
}

export type SketchMessageKey = 'sketch.conflict' | 'sketch.redundant' | 'sketch.solverFailed';

export interface SketchConstraintRow {
  readonly id: SketchConstraintId;
  readonly kind: SketchConstraint['kind'];
  /** Order within its kind from 1 ("Horizontal 2"). */
  readonly n: number;
  /** Only dimensions (DimensionKind); an angle in radians. */
  readonly value: number | null;
  readonly selected: boolean;
}

/** The id of the drawing of the edited sketch in ViewportPort.sketches. */
export const EDIT_SKETCH_DRAWING_ID = 'sketch-edit';

/** The overlay id of the snap guides of the inference preview (M26). */
export const SKETCH_GUIDES_OVERLAY_ID = 'sketch-guides';

const EMPTY_DATA: SketchData = Object.freeze({
  entities: Object.freeze([]),
  constraints: Object.freeze([]),
});
const NO_ITEMS: readonly SketchItemId[] = Object.freeze([]);
/** Solves of one addGeometry: all added constraints, without the conflicting, only fix and required. */
const MAX_ADD_SOLVES = 3;
const NO_ENTITIES: ReadonlySet<SketchItemId> = new Set<SketchItemId>();
const NO_PARAMS: Readonly<Record<string, number>> = Object.freeze({});
/** The keys of SketchState the drawing of the sketch does not show (refresh does not redraw). */
const NOT_DRAWN: ReadonlySet<keyof SketchState> = new Set<keyof SketchState>([
  'inference',
  'constructionMode',
]);
const MESSAGES: { readonly [K in SketchMessageKey]: { readonly key: K } } = Object.freeze({
  'sketch.conflict': Object.freeze({ key: 'sketch.conflict' }),
  'sketch.redundant': Object.freeze({ key: 'sketch.redundant' }),
  'sketch.solverFailed': Object.freeze({ key: 'sketch.solverFailed' }),
});

/** Opened only by the SketchEditor, over a feature session of a sketch. */
export function openSketchSession(deps: {
  edit: FeatureEditSession;
  /** The plane on opening (the artifact of the sketch, or its resolved reference). */
  plane: Plane;
  /** Neither could be computed (Q079): `plane` is the origin plane XY in its place. */
  planeMissing: boolean;
  /** The plane of a reference picked while sketching (app: planeOfRef over the last state). */
  resolvePlane: (ref: PlaneRef | TopoRef) => Plane | undefined;
  /** SketchEditor.showAllConstraints: the glyphs of all constraints, not only the selected ones (M25). */
  showAllConstraints: Observable<boolean>;
  solver: ConstraintSolver;
  /** M30: the geometry of the sketch in the kernel (SketchGeometry); no method yet, M33 and M35 add them. */
  geometry: SketchGeometry;
  /**
   * The drawings: the session draws the edited sketch and nothing else; screenToRay: the cursor
   * of a dragged dimension label (M28); overlay: the snap guides of the inference preview (M26).
   */
  viewport: Pick<ViewportPort, 'sketches' | 'screenToRay' | 'overlay'>;
  onClose: () => void;
}): SketchSession {
  const { edit, resolvePlane, showAllConstraints, solver, viewport, onClose } = deps;
  const plane = new ObservableValue<Plane>(deps.plane);
  /** The plane reference last followed; a change of the param moves the plane (M21). */
  let planeRef = planeRefOf(edit.state.get().params);
  /** SketchState.planeMissing; cleared by the first picked plane that resolves (Q079). */
  let planeMissing = deps.planeMissing;

  // The session's own state; the rest of SketchState comes from the feature session.
  let open = true;
  let status: SketchState['status'] = 'solving';
  let dof: number | null = null;
  let selection: readonly SketchItemId[] = NO_ITEMS;
  let hover: SketchItemId | null = null;
  let message: SketchState['message'] = null;
  let editingDimension: SketchConstraintId | null = null;
  /** The dimension of the dimension tool not written yet (previewDimension). */
  let preview: SketchConstraintDraft | null = null;
  /** The placement of a dragged dimension label, not written yet (moveDimension). */
  let moving: { readonly id: SketchConstraintId; readonly placement: DimensionPlacement } | null =
    null;
  /** The inference preview of a drawing tool with some kinds (setInferencePreview). */
  let inference: Pick<InferencePreview, 'at' | 'kinds'> | null = null;
  /** The guides of the inference preview are in the overlay. */
  let guidesShown = false;
  /** SketchState.constructionMode (setConstructionMode). */
  let constructionMode = false;
  /**
   * Queued or running jobs that may write to the sketch (SketchState.busy while open); a toggle of
   * construction waits for them.
   */
  let writers = 0;

  const state = new ObservableValue<SketchState>(buildState(null));
  draw();
  const unsubscribeEdit = edit.state.subscribe(() => {
    if (!edit.state.get().open) close();
    else refresh(followPlane());
  });
  const unsubscribeShowAll = showAllConstraints.subscribe(() => {
    refresh();
  });

  // ---- state ----

  /**
   * Runs a write without the solver now, or behind the pending writes: a solve that read the data
   * before would undo it with its own write (toggleConstruction, endMoveDimension).
   */
  function writeInTurn(apply: () => void): void {
    if (writers === 0) apply();
    else
      void enqueueWrite(() => {
        if (open) apply();
        return Promise.resolve();
      });
  }

  /** The data in the document; invalid data reads as empty. */
  function readData(): SketchData {
    const { params } = edit.state.get();
    const parsed = parseSketchData(params[SKETCH_PARAM.entities], params[SKETCH_PARAM.constraints]);
    return parsed.ok ? parsed.value : EMPTY_DATA;
  }

  function buildState(prev: SketchState | null): SketchState {
    const data = withMoving(readData());
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
    const fullyDefined = status === 'ok' && dof === 0;
    const statusKey = statusKeyOf(status, fullyDefined);
    return Object.freeze({
      open,
      busy: open && writers > 0,
      name: edit.state.get().name,
      entities,
      constraints,
      status,
      dof,
      fullyDefined,
      statusKey,
      statusParams: statusParamsOf(statusKey, dof, prev?.statusParams ?? NO_PARAMS),
      selection: prev !== null && sameIds(prev.selection, selection) ? prev.selection : selection,
      hover,
      message,
      constraintRows: rows,
      editingDimension,
      dimensions: dimensionViews(
        plane.get(),
        entities,
        constraints,
        selection,
        prev?.dimensions ?? [],
        preview,
      ),
      patternDimensions: patternDimensionViews(
        plane.get(),
        entities,
        selection,
        prev?.patternDimensions ?? [],
      ),
      glyphs: glyphViews(
        plane.get(),
        { entities, constraints },
        showAllConstraints.get()
          ? 'all'
          : glyphsShownFor({ entities, constraints }, selection, hover),
        selection,
        hover,
        prev?.glyphs ?? [],
      ),
      inference: inferenceOf(plane.get(), open ? inference : null, prev?.inference ?? null),
      planeField: planeFieldOf(edit.state.get(), prev?.planeField ?? null),
      planeMissing,
      constructionMode,
    });
  }

  /** The data with the placement of the dragged dimension, if any (moveDimension). */
  function withMoving(data: SketchData): SketchData {
    const m = moving;
    if (m === null) return data;
    return {
      entities: data.entities,
      constraints: data.constraints.map((c) =>
        c.id === m.id && isDimension(c) ? withPlacement(c, m.placement) : c,
      ),
    };
  }

  /**
   * Publishes a new snapshot unless nothing has changed, and redraws the sketch; `redraw` also
   * when only the plane moved. A change of only the inference preview (every move of a drawing
   * tool) or of the construction mode does not redraw: the drawing does not show them.
   */
  function refresh(redraw = false): void {
    const prev = state.get();
    const next = buildState(prev);
    const keys = Object.keys(next) as (keyof SketchState)[]; // the keys of the snapshot just built
    const changed = keys.filter((key) => !Object.is(next[key], prev[key]));
    if (changed.length > 0) state.set(next);
    if (open && (changed.some((key) => !NOT_DRAWN.has(key)) || redraw)) draw();
  }

  /** The guides as dashed construction lines in the overlay; none removes them. */
  function drawGuides(guides: readonly SnapGuide[]): void {
    if (guides.length === 0) {
      if (guidesShown) viewport.overlay.remove(SKETCH_GUIDES_OVERLAY_ID);
      guidesShown = false;
      return;
    }
    const p = plane.get();
    const shape: OverlayShape = {
      kind: 'lines',
      points: guides.flatMap((g) => [planeMath.toWorld(p, g.from), planeMath.toWorld(p, g.to)]),
      style: 'construction',
    };
    viewport.overlay.set(SKETCH_GUIDES_OVERLAY_ID, [shape]);
    guidesShown = true;
  }

  /**
   * Follows a change of the param SKETCH_PARAM.plane (M21): the plane of the new reference. A
   * reference that does not resolve (a face that is not planar) keeps the plane; the regeneration
   * reports it. Picking the plane is ended by interaction (pickEndsFocus of 'planes'), also when
   * the picked plane is the current one. A plane that resolves clears planeMissing (Q079), also
   * when it is XY the sketch is already on. true = the plane moved.
   */
  function followPlane(): boolean {
    const ref = planeRefOf(edit.state.get().params);
    if (ref === undefined || (planeRef !== undefined && samePlaneRef(planeRef, ref))) return false;
    planeRef = ref;
    const next = resolvePlane(ref);
    if (next !== undefined) planeMissing = false;
    const moved = next !== undefined && next !== plane.get();
    if (moved) plane.set(next);
    return moved;
  }

  /**
   * The style of an item; `selectedVia` and `hoveredVia` are the entities of the selected and the
   * hovered constraints (M25), drawn like selected and hovered ones.
   */
  function styleOf(
    id: SketchItemId,
    construction: boolean,
    selectedVia: ReadonlySet<SketchItemId>,
    hoveredVia: ReadonlySet<SketchItemId>,
  ): SketchStyle {
    const s = state.get();
    if (s.selection.includes(id) || selectedVia.has(id)) return 'selected';
    if (s.hover === id || hoveredVia.has(id)) return 'hover';
    if (construction) return 'construction';
    return s.fullyDefined ? 'defined' : 'normal';
  }

  function draw(): void {
    const s = state.get();
    const construction = new Set<string>(
      s.entities.flatMap((e) =>
        e.kind !== 'point' && !isPattern(e) && e.construction === true ? [e.id] : [],
      ),
    );
    const selectedVia = entitiesOfConstraints(s.constraints, s.selection);
    const hoveredVia = entitiesOfConstraints(s.constraints, s.hover === null ? [] : [s.hover]);
    viewport.sketches.set(
      EDIT_SKETCH_DRAWING_ID,
      toSketchDrawing(
        plane.get(),
        s,
        (id) => styleOf(id, construction.has(id), selectedVia, hoveredVia),
        { origin: true, editing: true },
      ),
    );
  }

  /** The drawing goes and onClose runs even if a subscriber throws; its error goes on after. */
  function close(): void {
    if (!open) return;
    open = false;
    unsubscribeEdit();
    unsubscribeShowAll();
    inference = null;
    try {
      refresh();
    } finally {
      try {
        drawGuides([]);
        viewport.sketches.remove(EDIT_SKETCH_DRAWING_ID);
      } finally {
        onClose();
      }
    }
  }

  function checkOpen(what: string): void {
    assert(open, `${what}: the sketch session is closed`);
  }

  // ---- the queue ----

  let running = false;
  const waiting: (() => void)[] = [];

  /**
   * Runs the job after the ones before it; an idle queue starts it synchronously, so the solver
   * reads its input in the call of the command. A job that throws synchronously rejects its
   * promise like an async one, and the queue goes on with the next job (C9).
   */
  function enqueue<T>(job: () => Promise<T>, onSettled?: () => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = (): void => {
        running = true;
        promiseOf(job)
          // The queue moves on before the caller hears of its job: once the promise of a command
          // settles, busy is up to date and the next job has started.
          .finally(() => {
            try {
              onSettled?.();
            } finally {
              startNext();
            }
          })
          .then(resolve, reject);
      };
      if (running) waiting.push(start);
      else start();
    });
  }

  function startNext(): void {
    const start = waiting.shift();
    if (start === undefined) running = false;
    else start();
  }

  /**
   * A job that may write to the sketch: the session is busy from now until it settles (D8). A
   * throwing subscriber of busy goes to the caller; the job stays queued and counted.
   */
  function enqueueWrite<T>(job: () => Promise<T>): Promise<T> {
    writers++;
    const done = enqueue(job, () => {
      writers--;
      if (writers === 0 && open) refresh();
    });
    if (writers === 1) refresh();
    return done;
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
    edit.setParams({ [SKETCH_PARAM.entities]: entities, [SKETCH_PARAM.constraints]: constraints });
  }

  /**
   * Solves `build(current data)` and writes it on 'ok'. `rejectRedundant` = an added constraint
   * the solver calls redundant is refused.
   */
  function change(
    build: (data: SketchData) => SketchData,
    opts: {
      readonly rejectRedundant?: SketchConstraintId;
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
      accept(result, { entities: result.entities ?? next.entities, constraints: next.constraints });
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
    plane: plane.asObservable(),
    state: state.asObservable(),
    addGeometry(add, opts = {}) {
      checkOpen('addGeometry');
      const { required } = opts;
      const kept = add.constraints.filter((c) => c.kind === 'fix' || required?.has(c.id) === true);
      return enqueueWrite(async () => {
        const data = readData();
        const entities = [...data.entities, ...add.entities];
        const tried: (readonly SketchConstraint[])[] = [];
        let attempt: readonly SketchConstraint[] | null = add.constraints;
        while (attempt !== null) {
          tried.push(attempt);
          const next = { entities, constraints: [...data.constraints, ...attempt] };
          const result = await solve(next);
          if (!open) return false;
          if (result === null || result.status === 'failed') return reject('sketch.solverFailed');
          if (result.status === 'ok') {
            const redundant = new Set(result.redundant);
            const own = new Set(attempt.map((c) => c.id));
            const constraints = next.constraints.filter(
              (c) => !(own.has(c.id) && redundant.has(c.id)),
            );
            accept(result, { entities: result.entities ?? entities, constraints });
            refresh();
            return true;
          }
          attempt = retryOf(attempt, new Set(result.conflicting), kept, tried);
        }
        return reject('sketch.conflict');
      });
    },
    addConstraint(c) {
      checkOpen('addConstraint');
      if (isDimension(c) && preview !== null) {
        preview = null;
        refresh();
      }
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
      const dim = readData().constraints.find((c) => c.id === id && isDimension(c));
      if (dim === undefined || !Number.isFinite(value) || value <= 0) return Promise.resolve(false);
      // An angle of π or more would make the data invalid (parseSketchData, M28).
      if (dim.kind === 'angle' && value >= Math.PI) return Promise.resolve(false);
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
      writeInTurn(apply);
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
    previewDimension(draft) {
      checkOpen('previewDimension');
      if (draft === preview) return;
      preview = draft === null ? null : Object.freeze(draft);
      refresh();
    },
    moveDimension(id, x, y) {
      checkOpen('moveDimension');
      // With the placement dragged so far: a degenerate cursor keeps it (movePlacement).
      const data = withMoving(readData());
      const c = data.constraints.find(
        (k): k is DimensionConstraint => k.id === id && isDimension(k),
      );
      if (c === undefined) return;
      const world = planeMath.intersectRay(plane.get(), viewport.screenToRay(x, y));
      if (world === null) return;
      const cursor = planeMath.toLocal(plane.get(), world);
      moving = Object.freeze({ id, placement: Object.freeze(movePlacement(c, cursor, data)) });
      refresh();
    },
    endMoveDimension() {
      checkOpen('endMoveDimension');
      const target = moving;
      if (target === null) return;
      const apply = (): void => {
        // A later move replaced the target: that one is written by its own end.
        if (moving !== target) return;
        const next = withMoving(readData());
        moving = null;
        write(next);
        refresh();
      };
      // Like toggleConstruction: behind a pending solve it waits its turn, or that solve's write
      // would undo it (the solve read the data before the move).
      writeInTurn(apply);
    },
    setPatternParam(pattern, param, value) {
      checkOpen('setPatternParam');
      const current = readData().entities.find((e) => e.id === pattern);
      if (current === undefined || !isPattern(current)) return false;
      if (withPatternParam(current, param, value) === null) return false;
      writeInTurn(() => {
        // The data when its turn comes: the pattern may have changed or gone meanwhile.
        const data = readData();
        const entities = data.entities.map((e) => {
          if (e.id !== pattern || !isPattern(e)) return e;
          return withPatternParam(e, param, value) ?? e;
        });
        write({ entities, constraints: data.constraints });
      });
      return true;
    },
    setInferencePreview(p) {
      checkOpen('setInferencePreview');
      drawGuides(p?.guides ?? []);
      inference =
        p === null || p.kinds.length === 0
          ? null
          : Object.freeze({ at: p.at, kinds: Object.freeze([...p.kinds]) });
      refresh();
    },
    setConstructionMode(on) {
      checkOpen('setConstructionMode');
      constructionMode = on;
      refresh();
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
    pickPlane() {
      checkOpen('pickPlane');
      if (state.get().planeField === null) return;
      edit.focusRefParam(SKETCH_PARAM.plane);
    },
    cancelPlanePick() {
      checkOpen('cancelPlanePick');
      if (edit.state.get().activeRefParam !== SKETCH_PARAM.plane) return false;
      edit.focusRefParam(null);
      return true;
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

/**
 * The added constraints of the next attempt after a conflict (M26): without the conflicting ones
 * except `kept` (fix and required, never left out), or when that leaves out nothing new, only
 * `kept`. null = nothing new to try;
 * at most three attempts in all.
 */
function retryOf(
  attempt: readonly SketchConstraint[],
  conflicting: ReadonlySet<SketchConstraintId>,
  kept: readonly SketchConstraint[],
  tried: readonly (readonly SketchConstraint[])[],
): readonly SketchConstraint[] | null {
  if (tried.length >= MAX_ADD_SOLVES) return null;
  const fresh = (c: readonly SketchConstraint[]): boolean =>
    !tried.some((t) => t.length === c.length && t.every((x, i) => x === c[i]));
  const withoutConflicting = attempt.filter((c) => !conflicting.has(c.id) || kept.includes(c));
  if (tried.length === 1 && fresh(withoutConflicting)) return withoutConflicting;
  return fresh(kept) ? kept : null;
}

/**
 * SketchState.inference of the preview on the plane; `prev` while the anchor and the kinds stay
 * the same, so an unchanged preview does not publish a new state.
 */
function inferenceOf(
  plane: Plane,
  preview: Pick<InferencePreview, 'at' | 'kinds'> | null,
  prev: SketchState['inference'],
): SketchState['inference'] {
  if (preview === null) return null;
  const anchor = planeMath.toWorld(plane, preview.at);
  const same =
    prev !== null &&
    anchor.every((v, i) => Object.is(v, prev.anchor[i])) &&
    prev.kinds.length === preview.kinds.length &&
    prev.kinds.every((k, i) => k === preview.kinds[i]);
  return same ? prev : Object.freeze({ anchor, kinds: preview.kinds });
}

/** The dimension with the placement; a placement of another kind (never from movePlacement) keeps it. */
function withPlacement(c: DimensionConstraint, p: DimensionPlacement): DimensionConstraint {
  switch (c.kind) {
    case 'angle':
      return p.kind === 'angular' ? { ...c, placement: p } : c;
    case 'radius':
    case 'diameter':
      return p.kind === 'radial' ? { ...c, placement: p } : c;
    case 'distance':
    case 'hDistance':
    case 'vDistance':
    case 'pointLineDistance':
      return p.kind === 'linear' ? { ...c, placement: p } : c;
  }
}

/** The promise of the job; a synchronous throw becomes its rejection. */
function promiseOf<T>(job: () => Promise<T>): Promise<T> {
  try {
    return job();
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- rejects with exactly what the job threw, like an async job
    return Promise.reject(e);
  }
}

/**
 * The field "Plane" from the visible plane param of the feature session; `prev` while it stays
 * the same, so an unchanged field does not publish a new state.
 */
function planeFieldOf(state: EditState, prev: SketchPlaneField | null): SketchPlaneField | null {
  const field = state.fields.find((f) => f.name === SKETCH_PARAM.plane && !f.hidden);
  if (field === undefined) return null;
  const next: SketchPlaneField = {
    label: field.spec.label,
    text: field.refText,
    active: field.active,
    invalid: field.issue !== null,
  };
  const same =
    prev !== null &&
    prev.label === next.label &&
    prev.active === next.active &&
    prev.invalid === next.invalid &&
    sameRefText(prev.text, next.text);
  return same ? prev : Object.freeze(next);
}

function sameRefText(a: RefText | null, b: RefText | null): boolean {
  if (a === null || b === null) return a === b;
  return a.key === b.key && sameFlat(a.params, b.params);
}

/** The translation key of the status line (spec 11, "Skicář"). */
function statusKeyOf(status: SketchState['status'], fullyDefined: boolean): string {
  switch (status) {
    case 'solving':
      return 'sketch.status.solving';
    case 'conflict':
      return 'sketch.conflict';
    case 'failed':
      return 'sketch.solverFailed';
    case 'ok':
      return fullyDefined ? 'sketch.status.defined' : 'sketch.status.dof';
  }
}

/** The params of the status key; the previous object while they stay the same. */
function statusParamsOf(
  key: string,
  dof: number | null,
  prev: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  if (key !== 'sketch.status.dof') return NO_PARAMS;
  const n = dof ?? 0;
  return prev.n === n ? prev : Object.freeze({ n });
}

/**
 * The entities whose glyphs are shown without showAllConstraints (spec 12, "Glyfy vazeb"): the
 * selected and the hovered items with the defining points of those that are curves, and the
 * entities of the selected and hovered geometric constraints. A constraint id in the set refers to
 * no entity, so it shows nothing by itself.
 */
function glyphsShownFor(
  data: SketchData,
  selection: readonly SketchItemId[],
  hover: SketchItemId | null,
): ReadonlySet<SketchItemId> {
  const items = hover === null ? selection : [...selection, hover];
  const points = data.entities.flatMap((e) =>
    items.includes(e.id) && e.kind !== 'point' && e.kind !== 'text' && !isPattern(e)
      ? curvePoints(e)
      : [],
  );
  return new Set<SketchItemId>([
    ...items,
    ...points,
    ...entitiesOfConstraints(data.constraints, items),
  ]);
}

/** The entities of the geometric constraints among `ids`; a dimension highlights nothing (M25). */
function entitiesOfConstraints(
  constraints: readonly SketchConstraint[],
  ids: readonly SketchItemId[],
): ReadonlySet<SketchItemId> {
  if (ids.length === 0) return NO_ENTITIES;
  return new Set<SketchItemId>(
    constraints.flatMap((c) =>
      ids.includes(c.id) && isGlyphConstraint(c) ? constraintTargets(c) : [],
    ),
  );
}

/** The rows of the panel; an unchanged row stays the same object. */
function constraintRows(
  constraints: readonly SketchConstraint[],
  selection: readonly SketchItemId[],
  prev: readonly SketchConstraintRow[],
): readonly SketchConstraintRow[] {
  const numbers = constraintNumbers(constraints);
  const rows = constraints.map((c, i): SketchConstraintRow => {
    const row: SketchConstraintRow = {
      id: c.id,
      kind: c.kind,
      n: numbers[i] ?? 0,
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
