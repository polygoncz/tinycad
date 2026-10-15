// Placement of the HUD of a manipulator over the view (spec 11, rule 8): pure functions of
// projected points in px relative to the view area, kept out of ManipulatorHud.vue so they run in
// Node tests. interaction gives the world points (spec 10, "Režimy a HUD (M19)"), ui projects
// them and decides where the mode bar and the value field stand.

import type { HudField, ManipulatorHud } from '@/app';
import { vec3 } from '@/core';
import type { Vec3 } from '@/core';
import { MANIPULATOR_GLYPHS } from '@/interaction/constants';
import { degToRad, handleValueNumber, parseNumber } from './components/params/field-values';

/** A point in px relative to the top left corner of the view area. */
export type ScreenPoint = readonly [x: number, y: number];

export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

/** Room between the tip of an arrow and the mode bar, in px. */
const TOOLBAR_CLEARANCE_PX = 12;
/** Room between the end of the glyph and the value field, in px. */
const FIELD_CLEARANCE_PX = 16;
/**
 * The gap of the mode bar from the projected center, to the right and up (spec 11, rule 8):
 * beyond the glyphs (the arrow tip is the farthest, the arcs end sooner), so the bar covers no
 * handle. The sizes of the glyphs come from interaction (M20).
 */
const TOOLBAR_GAP_PX = MANIPULATOR_GLYPHS.arrowTipPx + TOOLBAR_CLEARANCE_PX;
/** Offset of the field from the projected handle: the shaft of an arrow or the radius of an arc + 16. */
const FIELD_OFFSET_PX: Readonly<Record<HudField['kind'], number>> = Object.freeze({
  linear: MANIPULATOR_GLYPHS.arrowShaftPx + FIELD_CLEARANCE_PX,
  angular: MANIPULATOR_GLYPHS.ringPx + FIELD_CLEARANCE_PX,
});
/** Where the field goes when the screen direction is unknown: as far to the right as a linear one. */
const FALLBACK_OFFSET_PX = FIELD_OFFSET_PX.linear;
/** Projections closer than this coincide: the handle points at the viewer. */
const COINCIDE_PX = 1e-6;

/**
 * The center of the value field: `offsetPx` from `a` (the projection of HudField.at) along the
 * screen direction towards `b` (the projection of at + direction). Coinciding projections, or no
 * `b`, put it to the right of `a` at the offset of a linear field (96 px); no `a` → null (the field
 * is hidden).
 */
export function fieldPosition(
  a: ScreenPoint | null,
  b: ScreenPoint | null,
  offsetPx: number,
): ScreenPoint | null {
  if (a === null) return null;
  const dx = b === null ? 0 : b[0] - a[0];
  const dy = b === null ? 0 : b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length < COINCIDE_PX) return [a[0] + FALLBACK_OFFSET_PX, a[1]];
  return [a[0] + (dx / length) * offsetPx, a[1] + (dy / length) * offsetPx];
}

/**
 * The top left corner of the mode bar of `size`: its bottom left corner 110 px right of and 110 px
 * above `center` (the projection of ManipulatorHud.center), moved inside `area` so it does not
 * leave the view. A bar larger than the area sticks to the top left corner. No center → null.
 */
export function toolbarPosition(
  center: ScreenPoint | null,
  size: ScreenSize,
  area: ScreenSize,
): ScreenPoint | null {
  if (center === null) return null;
  const x = center[0] + TOOLBAR_GAP_PX;
  const y = center[1] - TOOLBAR_GAP_PX - size.height;
  return [clamp(x, area.width - size.width), clamp(y, area.height - size.height)];
}

/** Whether a projected point lies in the view area (edges included); null → false. */
export function insideArea(point: ScreenPoint | null, area: ScreenSize): boolean {
  if (point === null) return false;
  const [x, y] = point;
  return x >= 0 && y >= 0 && x <= area.width && y <= area.height;
}

/** value limited to [0, max]; a negative max (too little room) gives 0. */
function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

/** The projection of a world point to px of the view area; null = out of the projection. */
export type Project = (world: Vec3) => ScreenPoint | null;

/** Where the HUD stands: top left corner of the bar, center of the field; null = hidden. */
export interface HudLayout {
  readonly barAt: ScreenPoint | null;
  readonly fieldAt: ScreenPoint | null;
}

const HIDDEN: HudLayout = Object.freeze({ barAt: null, fieldAt: null });

/**
 * The layout of the HUD over the view (spec 11, rule 8). The bar stands by toolbarPosition when it
 * is rendered (`barSize` measured, null = no bar) and the projected center lies in `area`. The
 * field stands by fieldPosition, offset by the kind of its handle (linear 96, angular 88 px), and
 * hides out of `area`. No hud → both hidden.
 */
export function hudLayout(
  hud: ManipulatorHud | null,
  project: Project,
  area: ScreenSize,
  barSize: ScreenSize | null,
): HudLayout {
  if (hud === null) return HIDDEN;
  const center = project(hud.center);
  const barAt =
    barSize !== null && insideArea(center, area) ? toolbarPosition(center, barSize, area) : null;
  const field = hud.field;
  if (field === null) return { barAt, fieldAt: null };
  const at = fieldPosition(
    project(field.at),
    project(vec3.add(field.at, field.direction)),
    FIELD_OFFSET_PX[field.kind],
  );
  return { barAt, fieldAt: insideArea(at, area) ? at : null };
}

/** The text of the input for a field: its rounded number (degrees for an angle); no field → ''. */
export function fieldText(field: Pick<HudField, 'value' | 'unit'> | null): string {
  return field === null ? '' : handleValueNumber(field.value, field.unit);
}

/**
 * What Enter or blur of the field writes (spec 11, rule 8): the typed text as the shown value for
 * setValue (degrees → radians). null = nothing to write: untouched text (the rounded text is not
 * the value), text that is not a number, or a field that only shows a drag.
 */
export function fieldCommit(
  text: string,
  field: Pick<HudField, 'value' | 'unit' | 'dragging'>,
): number | null {
  if (field.dragging || text === fieldText(field)) return null;
  const value = parseNumber(text);
  if (value === null) return null;
  return field.unit === 'angle' ? degToRad(value) : value;
}

/** The axis letter before the input; a neutral handle has none. */
export function axisLetter(tint: HudField['tint']): 'X' | 'Y' | 'Z' | null {
  switch (tint) {
    case 'x':
      return 'X';
    case 'y':
      return 'Y';
    case 'z':
      return 'Z';
    case 'neutral':
      return null;
  }
}
