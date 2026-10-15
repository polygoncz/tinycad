// Dimensions of the open sketch over the view (spec 11, "Režim skici"; M19.2 D4, M28): pure
// functions of projected points in px relative to the view area, kept out of SketchDimensions.vue
// so they run in Node tests. sketcher gives the world points of the drawing (SketchDimensionView
// .geometry, computed from the placement), ui only projects them and adds the arrows and the text.
// The model keeps an angle in radians; the panel and the view show and take degrees (spec 12).

import type { Vec3 } from '@/core';
import type { DimensionGeometry, SketchConstraintRow, SketchDimensionView } from '@/sketcher';
import { formatDimension, parseNumber } from './components/params/field-values';
import type { Project, ScreenPoint } from './manipulator-hud';

/** The kind of a dimension; the panel passes the kind of any constraint row (only 'angle' converts). */
type ShownKind = SketchConstraintRow['kind'];

/** How far an extension line runs past the dimension line. */
const EXTENSION_OVERSHOOT_PX = 4;
/** Length of an arrow and half of its base. */
const ARROW_LENGTH_PX = 6;
const ARROW_HALF_WIDTH_PX = 3;
/** Projections closer than this are one point: no direction to lay out along. */
const MIN_LENGTH_PX = 1;
/** The box of a label that the lines leave free: an estimate of the text width plus a margin. */
const LABEL_CHAR_PX = 7;
const LABEL_MARGIN_PX = 4;
const LABEL_HALF_HEIGHT_PX = 8;

export type ScreenSegment = readonly [ScreenPoint, ScreenPoint];
/** A filled arrow: the tip first, then the two corners of its base. */
export type ScreenTriangle = readonly [ScreenPoint, ScreenPoint, ScreenPoint];

/** Where one dimension is drawn, in px of the view area. */
export interface DimensionLayout {
  /**
   * linear: the two extension lines, then the dimension line; radial: the line through the curve,
   * then the leader on to the label; angular: the segments of the arc.
   */
  readonly lines: readonly ScreenSegment[];
  readonly arrows: readonly ScreenTriangle[];
  /** Centre of the label (the projected `geometry.label`); the text is always horizontal. */
  readonly labelAt: ScreenPoint;
}

/**
 * The layout of a dimension from the projected points of its `geometry` (spec 12, "Kresba"), or
 * null when a point is out of the projection or the drawing is shorter than 1 px on the screen.
 * - linear: extension lines from → lineFrom and to → lineTo, 4 px past the dimension line; the
 *   dimension line lineFrom–lineTo with arrows at its ends, extended to a label beyond them.
 * - radial: a radius has a leader centre → near with an arrow on the curve; a diameter the line
 *   far → near through the centre with arrows at both ends; both run on from near to the label.
 * - angular: the polyline of the arc with arrows at both ends along it.
 */
export function dimensionLayout(
  dim: SketchDimensionView,
  project: Project,
): DimensionLayout | null {
  const g = dim.geometry;
  switch (g.kind) {
    case 'linear':
      return linearLayout(g, project);
    case 'radial':
      return radialLayout(g, project);
    case 'angular':
      return angularLayout(g, project);
  }
}

type Geometry<K extends DimensionGeometry['kind']> = Extract<DimensionGeometry, { kind: K }>;

function linearLayout(g: Geometry<'linear'>, project: Project): DimensionLayout | null {
  const from = project(g.from);
  const to = project(g.to);
  const lineFrom = project(g.lineFrom);
  const lineTo = project(g.lineTo);
  const label = project(g.label);
  if (from === null || to === null || lineFrom === null || lineTo === null || label === null) {
    return null;
  }
  const length = distance(lineFrom, lineTo);
  if (length < MIN_LENGTH_PX) return null;
  const u = direction(lineFrom, lineTo);
  // The label beyond an end: the dimension line runs on to it (its projection on the line).
  const t = (label[0] - lineFrom[0]) * u[0] + (label[1] - lineFrom[1]) * u[1];
  const start = t < 0 ? along(lineFrom, u, t) : lineFrom;
  const end = t > length ? along(lineFrom, u, t) : lineTo;
  return {
    lines: [extensionLine(from, lineFrom), extensionLine(to, lineTo), [start, end]],
    arrows: [arrow(lineFrom, u), arrow(lineTo, [-u[0], -u[1]])],
    labelAt: label,
  };
}

/** From the measured point to the dimension line and 4 px past it (none past a zero offset). */
function extensionLine(point: ScreenPoint, onLine: ScreenPoint): ScreenSegment {
  if (distance(point, onLine) < MIN_LENGTH_PX) return [point, onLine];
  return [point, along(onLine, direction(point, onLine), EXTENSION_OVERSHOOT_PX)];
}

function radialLayout(g: Geometry<'radial'>, project: Project): DimensionLayout | null {
  const center = project(g.center);
  const near = project(g.near);
  const label = project(g.label);
  if (center === null || near === null || label === null) return null;
  const leader: ScreenSegment = [near, label];
  if (g.far === null) {
    if (distance(center, near) < MIN_LENGTH_PX) return null;
    return {
      lines: [[center, near], leader],
      arrows: [arrow(near, direction(near, center))],
      labelAt: label,
    };
  }
  const far = project(g.far);
  if (far === null || distance(far, near) < MIN_LENGTH_PX) return null;
  return {
    lines: [[far, near], leader],
    arrows: [arrow(near, direction(near, far)), arrow(far, direction(far, near))],
    labelAt: label,
  };
}

function angularLayout(g: Geometry<'angular'>, project: Project): DimensionLayout | null {
  const arc = projectAll(g.arc, project);
  const label = project(g.label);
  if (arc === null || label === null) return null;
  const lines: ScreenSegment[] = [];
  let length = 0;
  for (let i = 1; i < arc.length; i++) {
    const a = arc[i - 1];
    const b = arc[i];
    if (a === undefined || b === undefined) continue;
    lines.push([a, b]);
    length += distance(a, b);
  }
  if (length < MIN_LENGTH_PX) return null;
  return {
    lines,
    arrows: [endArrow(arc, false), endArrow(arc, true)],
    labelAt: label,
  };
}

/**
 * The layout with its lines cut around the label (M28, Pavel: a number crossed by the dimension
 * line is unreadable), like the gap in the dimension line of Fusion or Onshape. The box is
 * estimated from the length of `text` (LABEL_CHAR_PX per character), so it stays a pure function.
 */
export function withLabelGap(layout: DimensionLayout, text: string): DimensionLayout {
  const halfWidth = (text.length * LABEL_CHAR_PX) / 2 + LABEL_MARGIN_PX;
  const [cx, cy] = layout.labelAt;
  const box = {
    x0: cx - halfWidth,
    x1: cx + halfWidth,
    y0: cy - LABEL_HALF_HEIGHT_PX,
    y1: cy + LABEL_HALF_HEIGHT_PX,
  };
  return { ...layout, lines: layout.lines.flatMap((line) => outsideBox(line, box)) };
}

interface Box {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/** The parts of a segment outside an axis-aligned box (Liang–Barsky clipping, kept inverted). */
function outsideBox(segment: ScreenSegment, box: Box): readonly ScreenSegment[] {
  const [p, q] = segment;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  let enter = 0;
  let exit = 1;
  const edges: readonly (readonly [number, number])[] = [
    [-dx, p[0] - box.x0],
    [dx, box.x1 - p[0]],
    [-dy, p[1] - box.y0],
    [dy, box.y1 - p[1]],
  ];
  for (const [step, room] of edges) {
    if (step === 0) {
      if (room < 0) return [segment];
      continue;
    }
    const t = room / step;
    if (step < 0) enter = Math.max(enter, t);
    else exit = Math.min(exit, t);
  }
  if (enter >= exit) return [segment];
  const at = (t: number): ScreenPoint => [p[0] + dx * t, p[1] + dy * t];
  const parts: ScreenSegment[] = [];
  if (enter > 0) parts.push([p, at(enter)]);
  if (exit < 1) parts.push([at(exit), q]);
  return parts;
}

/**
 * The arrow at the first (or last) point of a polyline, its body towards the first point at least
 * 1 px away: the tangent of the arc at that end, robust to points that project onto each other.
 */
function endArrow(points: readonly ScreenPoint[], last: boolean): ScreenTriangle {
  const ordered = last ? [...points].reverse() : points;
  const [tip = [0, 0], ...rest] = ordered;
  const next = rest.find((p) => distance(tip, p) >= MIN_LENGTH_PX) ?? tip;
  return arrow(tip, direction(tip, next));
}

/** The projections of all points, or null when one is out of the projection. */
function projectAll(points: readonly Vec3[], project: Project): readonly ScreenPoint[] | null {
  const projected: ScreenPoint[] = [];
  for (const p of points) {
    const s = project(p);
    if (s === null) return null;
    projected.push(s);
  }
  return projected;
}

function distance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** The unit direction a → b; (0, 0) for one point. */
function direction(a: ScreenPoint, b: ScreenPoint): ScreenPoint {
  const length = distance(a, b);
  return length === 0 ? [0, 0] : [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
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

/** The value as the panel and the view show it: an angle in degrees, the rest as it is (mm). */
export function toShownValue(kind: ShownKind, value: number): number {
  return kind === 'angle' ? (value * 180) / Math.PI : value;
}

/** The value of the model from a shown one: degrees of an angle to radians. */
export function fromShownValue(kind: ShownKind, shown: number): number {
  return kind === 'angle' ? (shown * Math.PI) / 180 : shown;
}

/** The unit after the value field of a dimension in the panel. */
export function dimensionUnit(kind: ShownKind): string {
  return kind === 'angle' ? '°' : 'mm';
}

/** The text of the value field of a dimension: the shown value rounded (formatDimension). */
export function dimensionFieldText(dim: Pick<SketchDimensionView, 'kind' | 'value'>): string {
  return formatDimension(toShownValue(dim.kind, dim.value));
}

/**
 * The text of the label: the rounded shown value; 'R' before a radius ('R40'), '⌀' before a
 * diameter ('⌀80'), '°' after an angle in degrees ('90°').
 */
export function dimensionLabel(dim: Pick<SketchDimensionView, 'kind' | 'value'>): string {
  const value = dimensionFieldText(dim);
  switch (dim.kind) {
    case 'radius':
      return `R${value}`;
    case 'diameter':
      return `⌀${value}`;
    case 'angle':
      return `${value}°`;
    default:
      return value;
  }
}

/**
 * The value the field over a dimension writes (Enter or blur), in the units of the model: the
 * typed number (degrees of an angle converted to radians), or null when the text is no number or
 * the number shown in the field (dimensionFieldText), so an untouched field does not replace the
 * exact value by its rounding.
 */
export function editedDimensionValue(
  text: string,
  dim: Pick<SketchDimensionView, 'kind' | 'value'>,
): number | null {
  const typed = parseNumber(text);
  if (typed === null || typed === parseNumber(dimensionFieldText(dim))) return null;
  return fromShownValue(dim.kind, typed);
}
