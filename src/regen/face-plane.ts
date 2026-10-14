import { err, ok, vec3 } from '@/core';
import type { Plane, Result, Vec3 } from '@/core';
import type { BodyId, PlaneRef, TopoName, TopoRef } from '@/document';
import type { FacePlane } from '@/kernel';
import { isBody, isPlane } from './state';
import type { Body, RegenState } from './state';

// Planes of references (spec 07, spec 12 "Roviny a počátek"): the plane of a plane artifact or
// the sketch frame of a planar body face (M14, R106). Shared by BuildContext.resolvePlanes and
// planeOfRef, so a sketch builds on the same plane the editor shows.

/** Above this |normal · X| the projection of +X is too short; +Y is projected instead (spec 12). */
const X_PARALLEL_LIMIT = 0.9;

const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];

/**
 * The frame of a sketch on a planar face (spec 12): normal = the unit face normal (out of the
 * solid), origin = the projection of the world origin onto the face plane, xDir = the unit
 * projection of +X, or of +Y when |normal · X| ≥ 0.9. Orthonormal and frozen.
 */
export function sketchPlaneOfFace(face: FacePlane): Plane {
  const normal = vec3.normalize(face.normal);
  const origin = vec3.scale(normal, vec3.dot(face.origin, normal));
  const towards = Math.abs(vec3.dot(normal, X)) >= X_PARALLEL_LIMIT ? Y : X;
  const xDir = vec3.normalize(vec3.sub(towards, vec3.scale(normal, vec3.dot(towards, normal))));
  return Object.freeze({ origin, xDir, normal });
}

/**
 * The plane of one reference over a finished state, without warnings: what resolvePlanes gives
 * a builder, for the app to show the plane of an edited sketch (M14). Anything unresolved, a
 * non-planar face too, gives undefined.
 */
export function planeOfRef(state: RegenState, ref: PlaneRef | TopoRef): Plane | undefined {
  const resolved = resolvePlaneRef(state, ref);
  return resolved.ok ? resolved.value.plane : undefined;
}

/** A resolved plane and the number of faces the name matched (1 for a plane artifact). */
export interface PlaneOfRef {
  readonly plane: Plane;
  readonly matches: number;
}

/** The plane of `ref` in `state`, or the message of why it does not resolve (spec 07, 08). */
export function resolvePlaneRef(
  state: RegenState,
  ref: PlaneRef | TopoRef,
): Result<PlaneOfRef, string> {
  if (ref.kind === 'plane') {
    const artifact = state.artifacts.get(ref.plane);
    if (artifact === undefined) return err(`Plane '${ref.plane}' does not exist`);
    if (!isPlane(artifact)) return err(`'${ref.plane}' is not a plane`);
    return ok({ plane: artifact.plane, matches: 1 });
  }
  const found = resolveNamed(state, ref.body, ref.name, 'face');
  if (!found.ok) return found;
  const { body, indices } = found.value;
  // indices are ascending and not empty: the first is the face with the smallest index.
  const [index] = indices;
  const face = index === undefined ? undefined : body.names.topology.faces[index];
  if (face?.surface !== 'plane' || face.plane === undefined) {
    return err(`Face '${ref.name}' is not planar`);
  }
  return ok({ plane: sketchPlaneOfFace(face.plane), matches: indices.length });
}

/** The body `id` of `state` and the indices of its faces or edges named `name` (≥ 1). */
export function resolveNamed(
  state: RegenState,
  id: BodyId,
  name: TopoName,
  entity: 'face' | 'edge',
): Result<{ readonly body: Body; readonly indices: readonly number[] }, string> {
  const artifact = state.artifacts.get(id);
  if (artifact === undefined) return err(`Body '${id}' does not exist`);
  if (!isBody(artifact)) return err(`'${id}' is not a body`);
  const indices = entity === 'face' ? artifact.names.faces(name) : artifact.names.edges(name);
  if (indices.length === 0) {
    return err(`${entity === 'face' ? 'Face' : 'Edge'} '${name}' not found on body '${id}'`);
  }
  return ok({ body: artifact, indices });
}
