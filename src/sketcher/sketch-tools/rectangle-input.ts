// The numeric input of the axis-parallel rectangles (spec 12, "Číselný vstup (M32)"): the second
// point of the rectangle by corners and of the center rectangle has the fields width and height,
// their sign from the quadrant of the cursor; the locked ones become required distances of the
// sides ab (the width) and bc (the height).

import type { Vec2 } from '@/core';
import type { SketchConstraint, SketchEntityId } from '@/sketch';
import type { ToolContext } from '@/interaction';
import type { InputField } from '../numeric-input';
import { newConstraintId } from './common';

/** The fields of the second point of an axis-parallel rectangle: its width and height. */
export const SIZE_FIELDS: readonly InputField[] = Object.freeze([
  Object.freeze({ id: 'width', kind: 'length' }),
  Object.freeze({ id: 'height', kind: 'length' }),
]);

/**
 * The corner opposite to `from` for the cursor and the entered `width`, `height` (in mm, measured
 * from `from` in x and y): each one on the side of the cursor (a cursor on the axis of `from`
 * counts as the positive side); the other coordinate from the cursor. `half` = the values are the
 * whole size of a rectangle around `from` (the center rectangle), so the corner is at half of
 * them.
 */
export function constrainSize(
  from: Vec2,
  cursor: Vec2,
  values: ReadonlyMap<string, number>,
  half: boolean,
): Vec2 {
  const scale = half ? 0.5 : 1;
  const along = (axis: 0 | 1, value: number | undefined): number => {
    if (value === undefined) return cursor[axis];
    const sign = cursor[axis] < from[axis] ? -1 : 1;
    return from[axis] + sign * scale * value;
  };
  return [along(0, values.get('width')), along(1, values.get('height'))];
}

/** The `width` and the `height` from `from` to `at` (twice them for `half`, see constrainSize). */
export function measureSize(from: Vec2, at: Vec2, half: boolean): ReadonlyMap<string, number> {
  const scale = half ? 2 : 1;
  return new Map([
    ['width', scale * Math.abs(at[0] - from[0])],
    ['height', scale * Math.abs(at[1] - from[1])],
  ]);
}

/**
 * The required dimensions of the locked size of a rectangle with the corners a, b, c (sides ab
 * horizontal, bc vertical): `width` → distance(a, b), `height` → distance(b, c).
 */
export function sizeDimensions(
  ctx: ToolContext,
  [a, b, c]: readonly [SketchEntityId, SketchEntityId, SketchEntityId],
  values: ReadonlyMap<string, number>,
): readonly SketchConstraint[] {
  return [
    ...distanceDimension(ctx, a, b, values.get('width')),
    ...distanceDimension(ctx, b, c, values.get('height')),
  ];
}

/** The distance dimension of the points a and b with the entered `value`; none without it. */
export function distanceDimension(
  ctx: ToolContext,
  a: SketchEntityId,
  b: SketchEntityId,
  value: number | null | undefined,
): readonly SketchConstraint[] {
  if (value === null || value === undefined) return [];
  return [{ kind: 'distance', id: newConstraintId(ctx), a, b, value }];
}
