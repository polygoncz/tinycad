// The sketcher (spec 10, "SketchEditor a SketchSession"; spec 12, "Režim skicáře"): opens a sketch
// feature through the FeatureEditor and edits it in that one transaction. The mode of the editor
// is 'sketch' exactly while a SketchSession is open; there is no other mode state (R45).

import { ObservableValue, assert } from '@/core';
import type { Observable, Plane } from '@/core';
import { ORIGIN_PLANES, ORIGIN_PLANE_IDS, samePlaneRef } from '@/document';
import type { FeatureId, PlaneRef, TopoRef } from '@/document';
import { SKETCH_FEATURE_TYPE, SKETCH_PARAM } from '@/sketch';
import type { ConstraintSolver } from '@/sketch';
import type { FeatureEditSession, FeatureEditor, Mode, ViewportPort } from '@/interaction';
import { frozenRef, planeRefOf } from './plane-ref';
import { openSketchSession } from './sketch-session';
import type { SketchSession } from './sketch-session';

export interface SketchEditor {
  readonly current: Observable<SketchSession | null>;
  /** 'sketch' ⇔ current !== null. */
  readonly mode: Observable<Mode>;
  /**
   * A new sketch on the plane: FeatureEditor.create(SKETCH_FEATURE_TYPE),
   * setParam(SKETCH_PARAM.plane) unless default. M14: also on a planar face of a body (TopoRef).
   */
  create(plane: PlaneRef | TopoRef): SketchSession;
  /** The plane of the reference (deps.resolvePlane); the entry tool asks it about a selected face (M14). */
  planeOf(ref: PlaneRef | TopoRef): Plane | undefined;
  /**
   * Editing an existing sketch (FeatureEditor.edit) on the plane of its artifact
   * (deps.planeOfSketch); only without one on the plane of its reference (M21, ADR 0025). Neither
   * (a face gone from the input of the sketch, Q079): on the origin plane XY with
   * SketchState.planeMissing and picking the plane at once (pickPlane).
   */
  edit(featureId: FeatureId): SketchSession;
  /**
   * New points of the drawing tools snap to the grid (M19.2 D4); true by default. The state of
   * the editor: it survives closing and opening a sketch and is not saved.
   */
  readonly gridSnap: Observable<boolean>;
  setGridSnap(on: boolean): void;
  /**
   * The glyphs of all constraints of the sketch, not only of the selected and hovered entities
   * (M25, the switch "Show constraints" of the panel); false by default. The state of the editor:
   * it survives closing and opening a sketch and is not saved.
   */
  readonly showAllConstraints: Observable<boolean>;
  setShowAllConstraints(on: boolean): void;
  /** The current step of the grid in mm (deps.gridStep); the tools read it on every snap. */
  gridStep(): number;
}

export interface SketchEditorDeps {
  /** Only opening the feature session: a new sketch or an existing one. */
  readonly features: Pick<FeatureEditor, 'create' | 'edit'>;
  readonly solver: ConstraintSolver;
  /**
   * The edited sketch is drawn under EDIT_SKETCH_DRAWING_ID; screenToRay places a dragged
   * dimension label in the plane (M28).
   */
  readonly viewport: Pick<ViewportPort, 'sketches' | 'screenToRay'>;
  /** app: planeOfRef over the last regeneration state (M14: origin planes and planar faces). */
  readonly resolvePlane: (ref: PlaneRef | TopoRef) => Plane | undefined;
  /**
   * The plane of the sketch artifact of the feature in the last state (M21, ADR 0025): the plane
   * the builder computed from the input of the sketch, so a sketch on a face opens also after a
   * later Transform or a Boolean that consumes the body (R108). undefined without an artifact (a
   * sketch in error); edit then resolves the reference.
   */
  readonly planeOfSketch: (featureId: FeatureId) => Plane | undefined;
  /**
   * The current step of the grid in mm (M19.2 D4); the tools read it on every move and click, so
   * the snap follows the grid drawn on the screen. Default () => 1.
   */
  readonly gridStep?: () => number;
}

/** The plane a sketch without a plane opens on (Q079): the origin plane XY. */
const ORIGIN_XY: Plane = (() => {
  const xy = ORIGIN_PLANES.find((p) => p.id === ORIGIN_PLANE_IDS.xy);
  assert(xy !== undefined, 'ORIGIN_PLANES has no XY plane');
  return xy.plane;
})();

export function createSketchEditor(deps: SketchEditorDeps): SketchEditor {
  const { features, solver, viewport, resolvePlane, planeOfSketch } = deps;
  const current = new ObservableValue<SketchSession | null>(null);
  const mode = new ObservableValue<Mode>('model');
  const gridSnap = new ObservableValue(true);
  const showAllConstraints = new ObservableValue(false);
  const gridStep = deps.gridStep ?? (() => 1);

  function checkCanOpen(what: string): void {
    assert(current.get() === null, `${what}: a sketch session is already open`);
  }

  /** Opens the session over the feature session; current first, then the mode. */
  function open(edit: FeatureEditSession, plane: Plane, planeMissing: boolean): SketchSession {
    const session = openSketchSession({
      edit,
      plane,
      planeMissing,
      resolvePlane,
      showAllConstraints: showAllConstraints.asObservable(),
      solver,
      viewport,
      // The mode goes back even if a subscriber of current throws; its error goes on after.
      onClose: () => {
        try {
          current.set(null);
        } finally {
          mode.set('model');
        }
      },
    });
    current.set(session);
    mode.set('sketch');
    return session;
  }

  /** Cancels the feature session when `fn` throws, so a failed open changes nothing. */
  function orCancel<T>(edit: FeatureEditSession, fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      edit.cancel();
      throw e;
    }
  }

  return {
    current: current.asObservable(),
    mode: mode.asObservable(),
    create(ref) {
      checkCanOpen('create');
      const plane = resolvePlane(ref);
      assert(plane !== undefined, `create: unknown plane ${JSON.stringify(ref)}`);
      const edit = features.create(SKETCH_FEATURE_TYPE);
      return orCancel(edit, () => {
        const current = planeRefOf(edit.state.get().params);
        if (current === undefined || !samePlaneRef(current, ref)) {
          edit.setParam(SKETCH_PARAM.plane, Object.freeze([frozenRef(ref)]));
        }
        return open(edit, plane, false);
      });
    },
    planeOf(ref) {
      return resolvePlane(ref);
    },
    edit(featureId) {
      checkCanOpen('edit');
      const edit = features.edit(featureId);
      return orCancel(edit, () => {
        assert(
          edit.schema.type === SKETCH_FEATURE_TYPE,
          `edit: feature '${featureId}' is a '${edit.schema.type}', not a sketch`,
        );
        const ref = planeRefOf(edit.state.get().params);
        const plane =
          planeOfSketch(featureId) ?? (ref === undefined ? undefined : resolvePlane(ref));
        if (plane !== undefined) return open(edit, plane, false);
        // Q079 A: the sketch opens on XY, so its entities can be moved to a new plane.
        const session = open(edit, ORIGIN_XY, true);
        session.pickPlane();
        return session;
      });
    },
    gridSnap: gridSnap.asObservable(),
    setGridSnap(on) {
      gridSnap.set(on);
    },
    showAllConstraints: showAllConstraints.asObservable(),
    setShowAllConstraints(on) {
      showAllConstraints.set(on);
    },
    gridStep() {
      return gridStep();
    },
  };
}
