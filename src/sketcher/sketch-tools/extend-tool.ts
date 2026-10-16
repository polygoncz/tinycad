// The extend tool (spec 12, "Trim, extend, split (M33)", "Extend"): a click near an end of a line
// or an arc moves that end (the nearer one by the parameter of the cursor) to the nearest
// intersection of its carrier beyond the end with another curve, construction ones and splines
// too. The carrier beyond the end is the temporary curve '__extend' (a line: a long line from the
// end outwards; an arc: its whole circle), intersected with the other curves by
// SketchGeometry.intersections asynchronously; the last request wins. Splines and circles are not
// extended; without an intersection nothing happens.

import { isPattern, curve2, extendEdit, paramRange, pointsById, samePoint } from '@/sketch';
import type { Curve2, CurveHit, SketchData, SketchEntityId } from '@/sketch';
import type { Tool, ToolContext } from '@/interaction';
import type { Vec2 } from '@/core';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';
import { arcPoints, clearPreview, clickTool, previewPolyline } from './common';
import { curveAt, idSource, unchanged } from './curve-pick';

/** The id of the temporary carrier curve in the intersection request. */
const EXTEND_ID = '__extend';

/**
 * The length of the ray of a line beyond its end in mm. Spec 12 names XLINE_EXTENT of sketch,
 * which track B introduces with the construction line (M31); until then the same value here.
 */
const XLINE_EXTENT = 1e5;

const TWO_PI = 2 * Math.PI;

/** An end of a line or an arc to extend: what the intersections are asked for. */
interface ExtendKey {
  readonly curve: SketchEntityId;
  readonly end: 'start' | 'end';
  /** The data of the request; other entities are another request. */
  readonly data: SketchData;
}

/** The new end: the point on the target curve and the preview of the extension. */
interface ExtendTarget {
  readonly point: Vec2;
  readonly by: SketchEntityId;
  readonly preview: readonly Vec2[];
}

/** The carrier beyond an end and how far along it a point lies (null = not beyond the end). */
interface Carrier {
  readonly curve: Curve2;
  /** The distance beyond the end of a point of the carrier at the parameter t of `curve`. */
  beyond(t: number, point: Vec2): number | null;
  /** The extension from the end to the point at the distance. */
  preview(distance: number, point: Vec2): readonly Vec2[];
}

interface Request {
  readonly key: ExtendKey;
  readonly answer: Promise<ExtendTarget | null>;
}

export function createExtendTool(sketches: SketchEditor): Tool {
  /** The last request; an answer of an older one is dropped. */
  let latest: Request | null = null;
  /** The position of the last move, so a late answer draws the preview only where it belongs. */
  let hover: ExtendKey | null = null;

  /** The request of the key: the current one when it is the same end of the same data. */
  function request(session: SketchSession, key: ExtendKey): Request {
    const last = latest;
    if (last !== null && sameKey(last.key, key)) return last;
    const next: Request = { key, answer: extendTarget(session, key) };
    latest = next;
    return next;
  }

  return clickTool(sketches, {
    reset() {
      latest = null;
      hover = null;
    },
    onMove(ctx, session, x, y) {
      const key = extendKey(ctx, session, x, y);
      hover = key;
      if (key === null) {
        clearPreview(ctx);
        return;
      }
      const req = request(session, key);
      void req.answer.then((target) => {
        // Only the answer of the last request, while the cursor is still at that end.
        if (latest !== req || hover === null || !sameKey(hover, key)) return;
        if (target === null) clearPreview(ctx);
        else previewPolyline(ctx, session, target.preview);
      });
    },
    onClick(ctx, session, x, y) {
      const key = extendKey(ctx, session, x, y);
      clearPreview(ctx);
      hover = null;
      if (key === null) return;
      const req = request(session, key);
      void req.answer.then(async (target) => {
        if (latest !== req || target === null || !unchanged(session, key.data)) return;
        const edit = extendEdit(
          key.data,
          { curve: key.curve, end: key.end, point: target.point, by: target.by },
          idSource(ctx),
        );
        if (edit !== null) await session.rewrite(edit.data, edit.added);
      });
    },
  });
}

function sameKey(a: ExtendKey, b: ExtendKey): boolean {
  return a.curve === b.curve && a.end === b.end && a.data.entities === b.data.entities;
}

/** The line or arc under the cursor and its nearer end; null for anything else. */
function extendKey(
  ctx: ToolContext,
  session: SketchSession,
  x: number,
  y: number,
): ExtendKey | null {
  const picked = curveAt(ctx, session, x, y);
  if (picked === null) return null;
  const { entity, curve, t } = picked;
  if (entity.kind !== 'line' && entity.kind !== 'arc') return null;
  const [lo, hi] = paramRange(curve);
  return { curve: entity.id, end: t - lo <= hi - t ? 'start' : 'end', data: picked.data };
}

/** Asks the kernel where the carrier beyond the end meets another curve first; null for nowhere. */
async function extendTarget(session: SketchSession, key: ExtendKey): Promise<ExtendTarget | null> {
  const points = pointsById(key.data);
  const others: Curve2[] = [];
  let carrier: Carrier | null = null;
  for (const e of key.data.entities) {
    if (e.kind === 'point' || isPattern(e)) continue;
    const curve = curve2(e, points);
    if (e.id !== key.curve) others.push(curve);
    else carrier = carrierOf(curve, key.end);
  }
  if (carrier === null) return null;
  let hits: readonly CurveHit[];
  try {
    hits = await session.geometry.intersections([carrier.curve, ...others]);
  } catch {
    // The kernel failed (or is not running): nothing to offer.
    return null;
  }
  let best: { readonly distance: number; readonly point: Vec2; readonly by: string } | null = null;
  for (const hit of hits) {
    const own = hit.a === EXTEND_ID ? hit.ta : hit.b === EXTEND_ID ? hit.tb : null;
    const by = hit.a === EXTEND_ID ? hit.b : hit.a;
    if (own === null || by === EXTEND_ID) continue;
    const distance = carrier.beyond(own, hit.point);
    if (distance !== null && (best === null || distance < best.distance)) {
      best = { distance, point: hit.point, by };
    }
  }
  if (best === null) return null;
  const by = key.data.entities.find((e) => e.id === best.by)?.id;
  if (by === undefined) return null;
  return { point: best.point, by, preview: carrier.preview(best.distance, best.point) };
}

/** The carrier of a line or an arc beyond its end. */
function carrierOf(curve: Curve2, end: 'start' | 'end'): Carrier | null {
  if (curve.kind === 'line') {
    const [tip, back] = end === 'start' ? [curve.from, curve.to] : [curve.to, curve.from];
    const length = Math.hypot(tip[0] - back[0], tip[1] - back[1]);
    if (length === 0) return null;
    const dir: Vec2 = [(tip[0] - back[0]) / length, (tip[1] - back[1]) / length];
    const far: Vec2 = [tip[0] + dir[0] * XLINE_EXTENT, tip[1] + dir[1] * XLINE_EXTENT];
    return {
      curve: { kind: 'line', from: tip, to: far, id: EXTEND_ID },
      beyond: (t, point) => (samePoint(point, tip) ? null : t * XLINE_EXTENT),
      preview: (_distance, point) => [tip, point],
    };
  }
  if (curve.kind !== 'arc') return null;
  const { center } = curve;
  const radius = Math.hypot(curve.from[0] - center[0], curve.from[1] - center[1]);
  const [, sweep] = paramRange(curve);
  const gap = TWO_PI - sweep;
  const tip = end === 'start' ? curve.from : curve.to;
  const other = end === 'start' ? curve.to : curve.from;
  const tipAngle = Math.atan2(tip[1] - center[1], tip[0] - center[0]);
  // Beyond the end of a counter-clockwise arc is counter-clockwise, beyond its start clockwise.
  const outward = (end === 'end') === curve.ccw ? 1 : -1;
  return {
    curve: { kind: 'circle', center, radius, id: EXTEND_ID },
    beyond(t, point) {
      if (samePoint(point, tip) || samePoint(point, other)) return null;
      const distance = mod2pi(outward * (t - tipAngle));
      return distance < gap ? distance : null;
    },
    preview: (distance) =>
      outward === 1
        ? arcPoints(center, radius, tipAngle, distance)
        : arcPoints(center, radius, tipAngle - distance, distance),
  };
}

function mod2pi(a: number): number {
  const m = a % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}
