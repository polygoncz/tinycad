// When the viewport sends viewChanged (spec 09, "Vzhled od M19 (styl Fusion)"): after a frame whose
// camera (target, orientation, halfHeight) or view area size differs from the previous frame. Pure,
// no three import, tested in Node.

import type { Quat, Vec3 } from '@/core';

/** What a frame drew with: the camera state and the size of the view area in CSS px. */
export interface ViewSnapshot {
  readonly target: Vec3;
  readonly orientation: Quat;
  readonly halfHeight: number;
  readonly width: number;
  readonly height: number;
}

/**
 * True when `next` differs from the previous frame `previous`, field by field (fresh arrays with
 * the same numbers are the same view); no previous frame (null, the first one after mount) → true.
 */
export function viewChangedSince(previous: ViewSnapshot | null, next: ViewSnapshot): boolean {
  if (previous === null) return true;
  return (
    !sameNumbers(previous.target, next.target) ||
    !sameNumbers(previous.orientation, next.orientation) ||
    previous.halfHeight !== next.halfHeight ||
    previous.width !== next.width ||
    previous.height !== next.height
  );
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
