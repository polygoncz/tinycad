// The sketcher (spec 10, "SketchEditor a SketchSession"; spec 12, "Režim skicáře"): opens a sketch
// feature through the FeatureEditor and edits it in that one transaction. The mode of the editor
// is 'sketch' exactly while a SketchSession is open; there is no other mode state (R45).

import { ObservableValue, assert } from '@/core';
import type { Observable, Plane } from '@/core';
import { readRefOf } from '@/document';
import type { FeatureId, PlaneRef, TopoRef } from '@/document';
import { SKETCH_FEATURE_TYPE } from '@/sketch';
import type { ConstraintSolver } from '@/sketch';
import type { FeatureEditSession, FeatureEditor } from './feature-editor';
import type { Mode } from './mode';
import { openSketchSession } from './sketch-session';
import type { SketchSession } from './sketch-session';
import type { ViewportPort } from './viewport-port';

export interface SketchEditor {
  readonly current: Observable<SketchSession | null>;
  /** 'sketch' ⇔ current !== null. */
  readonly mode: Observable<Mode>;
  /**
   * A new sketch on the plane: FeatureEditor.create(SKETCH_FEATURE_TYPE), setParam('plane') unless
   * default. M14: also on a planar face of a body (TopoRef).
   */
  create(plane: PlaneRef | TopoRef): SketchSession;
  /** The plane of the reference (deps.resolvePlane); the entry tool asks it about a selected face (M14). */
  planeOf(ref: PlaneRef | TopoRef): Plane | undefined;
  /** Editing an existing sketch (FeatureEditor.edit). */
  edit(featureId: FeatureId): SketchSession;
}

/** The param of the sketch feature with its plane (spec 12, "Featura skici"). */
const PLANE_PARAM = 'plane';

export function createSketchEditor(deps: {
  features: FeatureEditor;
  solver: ConstraintSolver;
  /** The edited sketch is drawn under EDIT_SKETCH_DRAWING_ID; only the drawings are needed. */
  viewport: Pick<ViewportPort, 'sketches'>;
  /** app: planeOfRef over the last regeneration state (M14: origin planes and planar faces). */
  resolvePlane: (ref: PlaneRef | TopoRef) => Plane | undefined;
}): SketchEditor {
  const { features, solver, viewport, resolvePlane } = deps;
  const current = new ObservableValue<SketchSession | null>(null);
  const mode = new ObservableValue<Mode>('model');

  function checkCanOpen(what: string): void {
    assert(current.get() === null, `${what}: a sketch session is already open`);
  }

  /** Opens the session over the feature session; current first, then the mode. */
  function open(edit: FeatureEditSession, plane: Plane): SketchSession {
    const session = openSketchSession({
      edit,
      plane,
      solver,
      viewport,
      onClose: () => {
        current.set(null);
        mode.set('model');
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
        if (current === undefined || !sameRef(current, ref)) {
          edit.setParam(PLANE_PARAM, Object.freeze([frozenRef(ref)]));
        }
        return open(edit, plane);
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
        const plane = ref === undefined ? undefined : resolvePlane(ref);
        assert(plane !== undefined, `edit: the plane of sketch '${featureId}' cannot be resolved`);
        return open(edit, plane);
      });
    },
  };
}

/**
 * The first item of the param 'plane' as a PlaneRef or a TopoRef (M14), or undefined when it is
 * neither.
 */
function planeRefOf(params: Readonly<Record<string, unknown>>): PlaneRef | TopoRef | undefined {
  const value = params[PLANE_PARAM];
  if (!Array.isArray(value)) return undefined;
  const items: readonly unknown[] = value;
  return readRefOf(['plane', 'topo'], items[0]);
}

function sameRef(a: PlaneRef | TopoRef, b: PlaneRef | TopoRef): boolean {
  if (a.kind === 'plane') return b.kind === 'plane' && a.plane === b.plane;
  return b.kind === 'topo' && a.body === b.body && a.name === b.name;
}

/** A frozen copy with only the fields of its kind, never shared with the caller. */
function frozenRef(ref: PlaneRef | TopoRef): PlaneRef | TopoRef {
  return ref.kind === 'plane'
    ? Object.freeze({ kind: 'plane', plane: ref.plane })
    : Object.freeze({ kind: 'topo', body: ref.body, name: ref.name });
}
