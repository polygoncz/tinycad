import type { Vec2 } from '@/core';
import type { Curve2 } from './curve2';
import type {
  SketchData,
  SketchEntityId,
  SketchPoint,
  SketchText,
  TextContour,
  TextFontId,
} from './model';
import { patternOfCopy } from './patterns';
import { pointsById } from './points';

// Sketch text (spec 12 "Text ve skice (M37)", ADR 0029). The TextOutliner port turns a string into
// letter outlines; the adapter lives in text-opentype (opentype.js and the bundled fonts), tests
// use the fake outliner from testing.ts. The outlines are stored in the data in the local
// coordinates of the text; textCurves places them along the baseline without any font.

/** Port: letter outlines of a one-line text in its local coordinates (x along the baseline, y up, mm). */
export interface TextOutliner {
  outline(p: {
    readonly text: string;
    readonly font: TextFontId;
    readonly height: number;
  }): Promise<readonly TextContour[]>;
  /** Width of the baseline (advance after the last character) in mm – the length of the anchor line of a new text. */
  advance(p: {
    readonly text: string;
    readonly font: TextFontId;
    readonly height: number;
  }): Promise<number>;
}

/** The suffix of the derived id of a letter curve: '<char>-<code>.<loop>.<segment>'. */
const LETTER_SUFFIX = /^\d+-\d+\.\d+\.\d+$/;

/**
 * The curves of all texts of the sketch (construction ones too) in their real position, with
 * derived ids '<text>:<char>-<code>.<loop>.<segment>'; the loop counts within one character. A
 * segment of 2 poles is a line, of 3 or 4 a clamped B-spline of degree 2 or 3 with knots
 * [0…0, 1…1] (a Bézier curve exactly). Order: texts in entity order, contours, segments. A text
 * whose baseline has zero length (or is missing) has no curves. Frozen.
 */
export function textCurves(data: SketchData): readonly Curve2[] {
  const points = pointsById(data);
  const curves: Curve2[] = [];
  for (const text of data.entities) {
    if (text.kind !== 'text') continue;
    const place = placement(text, data, points);
    if (place === undefined) continue;
    const loops = new Map<number, number>();
    for (const contour of text.contours) {
      const loop = loops.get(contour.char) ?? 0;
      loops.set(contour.char, loop + 1);
      contour.segments.forEach((segment, index) => {
        const id = `${text.id}:${String(contour.char)}-${String(contour.code)}.${String(loop)}.${String(index)}`;
        curves.push(Object.freeze(segmentCurve(segment.map(place), id)));
      });
    }
  }
  return Object.freeze(curves);
}

/**
 * The id of the entity a derived curve comes from: the pattern of a copy (M36) or the text of a
 * letter curve (M37), else null. The letter grammar is a subset of the copy grammar
 * ('<id>:<i>-<j>.<rest>'); both name the owner by the prefix before the colon.
 */
export function derivedOwner(id: string): SketchEntityId | null {
  const pattern = patternOfCopy(id);
  if (pattern !== null) return pattern;
  const colon = id.indexOf(':');
  if (colon <= 0) return null;
  const owner = id.slice(0, colon);
  if (owner.includes(',') || !LETTER_SUFFIX.test(id.slice(colon + 1))) return null;
  // The prefix of a derived id is the id of its text entity (textCurves builds it so).
  return owner as SketchEntityId;
}

/**
 * The map from the local coordinates of the text to the sketch: P = p1 + x·û + y·(−û.y, û.x), û
 * the unit direction p1 → p2 of the baseline; undefined for a zero-length or missing baseline.
 */
function placement(
  text: SketchText,
  data: SketchData,
  points: ReadonlyMap<SketchEntityId, SketchPoint>,
): ((p: Vec2) => Vec2) | undefined {
  const baseline = data.entities.find((e) => e.id === text.baseline);
  if (baseline?.kind !== 'line') return undefined;
  const p1 = points.get(baseline.p1);
  const p2 = points.get(baseline.p2);
  if (p1 === undefined || p2 === undefined) return undefined;
  const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  // No direction to lay the text along: no curves rather than NaN coordinates (like a mirror).
  if (length === 0) return undefined;
  const ux = (p2.x - p1.x) / length;
  const uy = (p2.y - p1.y) / length;
  return ([x, y]) => Object.freeze([p1.x + x * ux - y * uy, p1.y + x * uy + y * ux]);
}

/** A segment of 2 poles → a line, 3 or 4 → a Bézier curve as a clamped B-spline. */
function segmentCurve(poles: readonly Vec2[], id: string): Curve2 {
  const [from, to] = poles;
  if (poles.length === 2 && from !== undefined && to !== undefined) {
    return { kind: 'line', from, to, id };
  }
  const degree = poles.length - 1;
  const knots = [...Array<number>(degree + 1).fill(0), ...Array<number>(degree + 1).fill(1)];
  return { kind: 'bspline', degree, poles: Object.freeze(poles), knots: Object.freeze(knots), id };
}
