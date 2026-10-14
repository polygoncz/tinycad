// Dimensions of the open sketch over the view (spec 11, "Režim skici"; M19.2 D4): pure functions
// of projected points in px relative to the view area, kept out of SketchDimensions.vue so they
// run in Node tests. interaction gives the world points (SketchState.dimensions), ui projects
// them and lays out the extension lines, the dimension line with its arrows and the label.

import type { SketchDimensionView } from '@/interaction';
import { formatDimension, parseNumber } from './components/params/field-values';
import type { Project, ScreenPoint } from './manipulator-hud';

/** The default distance of the dimension line from the measured points. */
const OFFSET_PX = 24;
/** How far an extension line runs past the dimension line. */
const EXTENSION_OVERSHOOT_PX = 4;
/** Distance of the label centre from the dimension line, along its normal. */
const LABEL_GAP_PX = 10;
/** Length of an arrow and half of its base. */
const ARROW_LENGTH_PX = 6;
const ARROW_HALF_WIDTH_PX = 3;
/** How far the leader of a radius runs past the curve. */
const LEADER_OVERSHOOT_PX = 16;
/** Distance of the label centre of a radius from the end of the leader. */
const RADIUS_LABEL_GAP_PX = 20;
/** Projections closer than this are one point: no direction to lay out along. */
const MIN_LENGTH_PX = 1;

export type ScreenSegment = readonly [ScreenPoint, ScreenPoint];
/** A filled arrow: the tip first, then the two corners of its base. */
export type ScreenTriangle = readonly [ScreenPoint, ScreenPoint, ScreenPoint];

/** Where one dimension is drawn, in px of the view area. */
export interface DimensionLayout {
  /** distance: the two extension lines, then the dimension line; radius: the leader. */
  readonly lines: readonly ScreenSegment[];
  readonly arrows: readonly ScreenTriangle[];
  /** Centre of the label; the text is always horizontal. */
  readonly labelAt: ScreenPoint;
}

/**
 * The layout of a dimension, or null when a point is out of the projection or both project to
 * less than 1 px apart.
 * - distance: the dimension line runs `offsetPx` from the points along the normal of A → B that
 *   points up on the screen (left for a vertical one), so the side does not depend on the order
 *   of the points; the label stands 10 px further.
 * - radius: a leader from the centre through the point on the curve, 16 px past it; the label
 *   past its end.
 */
export function dimensionLayout(
  dim: SketchDimensionView,
  project: Project,
  offsetPx = OFFSET_PX,
): DimensionLayout | null {
  const a = project(dim.from);
  const b = project(dim.to);
  if (a === null || b === null) return null;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < MIN_LENGTH_PX) return null;
  const u: ScreenPoint = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  return dim.kind === 'distance' ? distanceLayout(a, b, u, offsetPx) : radiusLayout(b, u, a);
}

function distanceLayout(
  a: ScreenPoint,
  b: ScreenPoint,
  u: ScreenPoint,
  offsetPx: number,
): DimensionLayout {
  const n = upNormal(u);
  const lineA = along(a, n, offsetPx);
  const lineB = along(b, n, offsetPx);
  const reach = offsetPx + EXTENSION_OVERSHOOT_PX;
  const middle: ScreenPoint = [(lineA[0] + lineB[0]) / 2, (lineA[1] + lineB[1]) / 2];
  return {
    lines: [
      [a, along(a, n, reach)],
      [b, along(b, n, reach)],
      [lineA, lineB],
    ],
    arrows: [arrow(lineA, u), arrow(lineB, [-u[0], -u[1]])],
    labelAt: along(middle, n, LABEL_GAP_PX),
  };
}

function radiusLayout(onCurve: ScreenPoint, u: ScreenPoint, centre: ScreenPoint): DimensionLayout {
  const end = along(onCurve, u, LEADER_OVERSHOOT_PX);
  return {
    lines: [[centre, end]],
    arrows: [],
    labelAt: along(end, u, RADIUS_LABEL_GAP_PX),
  };
}

/** The unit normal of the direction u that points up on the screen, or left when u is vertical. */
function upNormal(u: ScreenPoint): ScreenPoint {
  const n: ScreenPoint = [-u[1], u[0]];
  const flip = n[1] > 0 || (n[1] === 0 && n[0] > 0);
  return flip ? [-n[0], -n[1]] : n;
}

function along(p: ScreenPoint, dir: ScreenPoint, distance: number): ScreenPoint {
  return [p[0] + dir[0] * distance, p[1] + dir[1] * distance];
}

/** An arrow with its tip at `tip`, its body along `dir` (unit) behind the tip. */
function arrow(tip: ScreenPoint, dir: ScreenPoint): ScreenTriangle {
  const base = along(tip, dir, ARROW_LENGTH_PX);
  const side: ScreenPoint = [dir[1], -dir[0]];
  return [tip, along(base, side, ARROW_HALF_WIDTH_PX), along(base, side, -ARROW_HALF_WIDTH_PX)];
}

/** The text of the label: the rounded value, 'R' before a radius ('R40'). */
export function dimensionLabel(dim: Pick<SketchDimensionView, 'kind' | 'value'>): string {
  const value = formatDimension(dim.value);
  return dim.kind === 'radius' ? `R${value}` : value;
}

/**
 * The value the field over a dimension writes (Enter or blur): the typed number, or null when the
 * text is no number or the number shown in the field (formatDimension of `value`), so an
 * untouched field does not replace the exact value by its rounding.
 */
export function editedDimensionValue(text: string, value: number): number | null {
  const typed = parseNumber(text);
  return typed === null || typed === parseNumber(formatDimension(value)) ? null : typed;
}
