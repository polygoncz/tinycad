// The sketcher (spec 10, "SketchEditor a SketchSession"; spec 12, "Režim skicáře"): opens a sketch
// feature through the FeatureEditor and edits it in that one transaction. The mode of the editor
// is 'sketch' exactly while a SketchSession is open; there is no other mode state (R45).

import { ObservableValue, assert } from '@/core';
import type { IdGenerator, Observable, Plane } from '@/core';
import { parsePlaneId } from '@/document';
import type { FeatureId, PlaneId } from '@/document';
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
  /** A new sketch on the plane: FeatureEditor.create(SKETCH_FEATURE_TYPE), setParam('plane') unless default. */
  create(plane: PlaneId): SketchSession;
  /** Editing an existing sketch (FeatureEditor.edit). */
  edit(featureId: FeatureId): SketchSession;
}

/** The param of the sketch feature with its plane (spec 12, "Featura skici"). */
const PLANE_PARAM = 'plane';

export function createSketchEditor(deps: {
  features: FeatureEditor;
  solver: ConstraintSolver;
  /** The edited sketch is drawn under EDIT_SKETCH_DRAWING_ID. */
  viewport: ViewportPort;
  /** Ids of new entities and constraints are minted by the tools and actions; kept for them. */
  ids: IdGenerator;
  /** app: ORIGIN_PLANES (M14: also faces from the regeneration). */
  resolvePlane: (id: PlaneId) => Plane | undefined;
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
    create(planeId) {
      checkCanOpen('create');
      const plane = resolvePlane(planeId);
      assert(plane !== undefined, `create: unknown plane '${planeId}'`);
      const edit = features.create(SKETCH_FEATURE_TYPE);
      return orCancel(edit, () => {
        if (planeOf(edit.state.get().params) !== planeId) {
          edit.setParam(
            PLANE_PARAM,
            Object.freeze([Object.freeze({ kind: 'plane', plane: planeId })]),
          );
        }
        return open(edit, plane);
      });
    },
    edit(featureId) {
      checkCanOpen('edit');
      const edit = features.edit(featureId);
      return orCancel(edit, () => {
        assert(
          edit.schema.type === SKETCH_FEATURE_TYPE,
          `edit: feature '${featureId}' is a '${edit.schema.type}', not a sketch`,
        );
        const planeId = planeOf(edit.state.get().params);
        const plane = planeId === undefined ? undefined : resolvePlane(planeId);
        assert(plane !== undefined, `edit: the plane of sketch '${featureId}' cannot be resolved`);
        return open(edit, plane);
      });
    },
  };
}

/** The plane of the first item of the param 'plane', or undefined when it is not a PlaneRef. */
function planeOf(params: Readonly<Record<string, unknown>>): PlaneId | undefined {
  const value = params[PLANE_PARAM];
  if (!Array.isArray(value)) return undefined;
  const items: readonly unknown[] = value;
  const first = items[0];
  if (typeof first !== 'object' || first === null) return undefined;
  if (!('kind' in first) || first.kind !== 'plane' || !('plane' in first)) return undefined;
  return parsePlaneId(first.plane);
}
