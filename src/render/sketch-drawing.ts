// Tessellation of a sketch drawing (spec 09, "Skici"): curves in the 2D coordinates of the plane
// → world segments, points → world points, each with the id and the style of its entity, so the
// sketch layer can colour them and the picker can map a hit back to the entity. Pure, no three.

import { assert, plane as planeMath, type Vec2, type Vec3 } from '@/core';
import type { SketchDrawing, SketchDrawingCurve, SketchStyle } from '@/interaction';

/** Default maximum angle step of an arc segment: 5°. */
const DEFAULT_MAX_STEP = Math.PI / 36;
/**
 * Slack for the rounding of span / maxStep: π / (π/36) is 36.000…01 in floating point and would
 * otherwise give a 37th segment.
 */
const STEP_SLACK = 1e-9;

export interface SketchTessellation {
  /** World segments: x0, y0, z0, x1, y1, z1 per segment. */
  readonly segments: Float32Array<ArrayBuffer>;
  /** Id of the curve of every segment. */
  readonly segmentCurves: readonly string[];
  readonly segmentStyles: readonly SketchStyle[];
  /** World points: x, y, z per point. */
  readonly points: Float32Array<ArrayBuffer>;
  readonly pointIds: readonly string[];
  readonly pointStyles: readonly SketchStyle[];
}

/**
 * A line gives one segment; an arc max(2, ⌈(endAngle − startAngle) / maxStep⌉) segments of equal
 * angle, as a polyline from startAngle to endAngle. Points go through plane.toWorld.
 */
export function tessellateSketch(
  drawing: SketchDrawing,
  maxStep = DEFAULT_MAX_STEP,
): SketchTessellation {
  assert(maxStep > 0, 'maxStep must be positive');
  const toWorld = (v: Vec2): Vec3 => planeMath.toWorld(drawing.plane, v);

  const segments: number[] = [];
  const segmentCurves: string[] = [];
  const segmentStyles: SketchStyle[] = [];
  for (const curve of drawing.curves) {
    const polyline = curvePolyline(curve, maxStep);
    for (let i = 1; i < polyline.length; i++) {
      const from = polyline[i - 1];
      const to = polyline[i];
      if (from === undefined || to === undefined) continue;
      segments.push(...toWorld(from), ...toWorld(to));
      segmentCurves.push(curve.id);
      segmentStyles.push(curve.style);
    }
  }

  const points: number[] = [];
  for (const point of drawing.points) points.push(...toWorld(point.at));

  return {
    segments: new Float32Array(segments),
    segmentCurves,
    segmentStyles,
    points: new Float32Array(points),
    pointIds: drawing.points.map((p) => p.id),
    pointStyles: drawing.points.map((p) => p.style),
  };
}

/** Points of the curve in plane coordinates, consecutive pairs are its segments. */
function curvePolyline(curve: SketchDrawingCurve, maxStep: number): readonly Vec2[] {
  if (curve.kind === 'line') return [curve.from, curve.to];
  const span = curve.endAngle - curve.startAngle;
  const count = Math.max(2, Math.ceil(span / maxStep - STEP_SLACK));
  const result: Vec2[] = [];
  for (let i = 0; i <= count; i++) {
    const angle = curve.startAngle + (span * i) / count;
    result.push([
      curve.center[0] + curve.radius * Math.cos(angle),
      curve.center[1] + curve.radius * Math.sin(angle),
    ]);
  }
  return result;
}
