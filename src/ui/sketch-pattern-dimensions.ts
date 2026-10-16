// The dimensions of a selected pattern over the view (spec 12, "Zrcadlení a pole (M36)",
// "Vynesené kóty pole"): pure functions kept out of SketchPatternDimensions.vue so they run in
// Node tests, like ./sketch-dimensions. sketcher gives the label and the guide in the world
// (SketchPatternDimensionView), ui projects them and formats the value: a count "n×", a length
// "… mm" and an angle "…°" (the model keeps radians), rounded like the dimensions.

import type { Vec3 } from '@/core';
import type { SketchPatternDimensionView, SketchSession } from '@/sketcher';
import { formatDimension, parseNumber, radToDeg, degToRad } from './components/params/field-values';
import type { Project, ScreenPoint } from './manipulator-hud';
import type { DimensionLayout, ScreenSegment } from './sketch-dimensions';

type PatternValue = Pick<SketchPatternDimensionView, 'format' | 'value'>;

/**
 * The layout of a pattern dimension: its guide as a polyline without arrows (may be empty) and
 * the projected label, or null when the label or a point of the guide is out of the projection.
 * It is a DimensionLayout, so withLabelGap cuts the guide around the label.
 */
export function patternDimensionLayout(
  dim: SketchPatternDimensionView,
  project: Project,
): DimensionLayout | null {
  const labelAt = project(dim.label);
  if (labelAt === null) return null;
  const guide = projectAll(dim.guide, project);
  if (guide === null) return null;
  const lines: ScreenSegment[] = [];
  for (let i = 1; i < guide.length; i++) {
    const a = guide[i - 1];
    const b = guide[i];
    if (a !== undefined && b !== undefined) lines.push([a, b]);
  }
  return { lines, arrows: [], labelAt };
}

/** The value of the field: the shown number rounded like a dimension, an angle in degrees. */
export function patternFieldText(dim: PatternValue): string {
  return formatDimension(dim.format === 'angle' ? radToDeg(dim.value) : dim.value);
}

/** The text of the label: '4×', '12.5 mm', '90°'. */
export function patternDimensionLabel(dim: PatternValue): string {
  const value = patternFieldText(dim);
  switch (dim.format) {
    case 'count':
      return `${value}×`;
    case 'length':
      return `${value} mm`;
    case 'angle':
      return `${value}°`;
  }
}

/**
 * The value the field writes, in the units of the model (degrees of an angle to radians), or null
 * when the text is no number, a count no integer, or the number shown in the field
 * (patternFieldText), so an untouched field does not replace the exact value by its rounding.
 * The range (count, spacing > 0) is checked by the session.
 */
export function editedPatternValue(text: string, dim: PatternValue): number | null {
  const typed = parseNumber(text);
  if (typed === null || typed === parseNumber(patternFieldText(dim))) return null;
  if (dim.format === 'count' && !Number.isInteger(typed)) return null;
  return dim.format === 'angle' ? degToRad(typed) : typed;
}

/**
 * Enter or blur in the field of a pattern dimension: a valid changed value goes to
 * setPatternParam. True when the session took it; an invalid text calls nothing.
 */
export function commitPatternEdit(
  sketch: Pick<SketchSession, 'setPatternParam'>,
  dim: SketchPatternDimensionView,
  text: string,
): boolean {
  const value = editedPatternValue(text, dim);
  if (value === null) return false;
  return sketch.setPatternParam(dim.pattern, dim.param, value);
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
