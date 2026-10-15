// Partition of the scene for the passes of the AO pipeline (spec 09, "Víceprůchodové vykreslování
// (AO)", "Rozdělení scény"). The viewport partitions the scene, not the layers: a new layer added
// to the scene is interaction automatically. Outside a pass the scene stays unchanged, so picking,
// the scene bounds and the visibility set by the layers notice nothing.
import type * as THREE from 'three';

/** Root groups of the scene by pass. Computed in every AO frame (a few objects). */
export interface ScenePartition {
  /** [layers.main.group] */
  readonly model: readonly THREE.Object3D[];
  /** The other direct children of the scene. */
  readonly interaction: readonly THREE.Object3D[];
}

/**
 * interaction = scene.children without `model`, without lights (`isLight`) and without cameras
 * (`isCamera`). Lights and the camera with the headlight are drawn in both passes.
 */
export function partitionScene(
  scene: THREE.Scene,
  model: readonly THREE.Object3D[],
): ScenePartition {
  const modelSet = new Set(model);
  const interaction = scene.children.filter(
    (child) => !modelSet.has(child) && !isLight(child) && !isCamera(child),
  );
  return Object.freeze({
    model: Object.freeze([...model]),
    interaction: Object.freeze(interaction),
  });
}

/** All `isLineSegments2` objects in the subtrees of `roots` (GTAOPass does not hide them itself). */
export function aoExcluded(roots: readonly THREE.Object3D[]): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  for (const root of roots) {
    root.traverse((object) => {
      if ('isLineSegments2' in object && object.isLineSegments2 === true) found.push(object);
    });
  }
  return found;
}

/**
 * Sets `visible = false` on all `objects` for the time of `fn`, then restores the original
 * values, even when `fn` throws. An object that was hidden already stays hidden. Duplicates in
 * `objects` do not matter.
 */
export function hideDuring<T>(objects: readonly THREE.Object3D[], fn: () => T): T {
  // A Map keeps the value before the first hiding, so a duplicate does not record `false`.
  const original = new Map<THREE.Object3D, boolean>();
  for (const object of objects) {
    if (!original.has(object)) original.set(object, object.visible);
    object.visible = false;
  }
  try {
    return fn();
  } finally {
    for (const [object, visible] of original) object.visible = visible;
  }
}

function isLight(object: THREE.Object3D): boolean {
  return 'isLight' in object && object.isLight === true;
}

function isCamera(object: THREE.Object3D): boolean {
  return 'isCamera' in object && object.isCamera === true;
}
