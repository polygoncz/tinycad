// The offset tool (spec 12, "Offset (M35)", "Nástroj"): a click on a curve offsets its whole
// chain (chainOf) to the side of the cursor: a closed chain inwards when the cursor is inside it,
// an open one to the side of the nearest curve along the walk. The distance is the last one used
// in the session (the first time 10 % of the smaller size of the bounding box of the chain), or
// the field "Distance" of the numeric input (M32). The kernel is asked asynchronously for the
// offset under the cursor (the last request wins), the preview shows it, a click writes
// offsetEdit by SketchSession.rewrite and opens the offset dimension.

import type { Vec2 } from '@/core';
import { chainCurves, chainOf, isDimension, offsetEdit, paramRange, piecePolyline } from '@/sketch';
import type { Chain, Curve2, OffsetCurve2, SketchConstraintId, SketchData } from '@/sketch';
import type { Tool, ToolContext } from '@/interaction';
import type { InputField } from '../numeric-input';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';
import {
  clearPreview,
  clickTool,
  curvePairs,
  inputValues,
  previewIds,
  previewPairs,
  withHint,
} from './common';
import type { ToolMods } from './common';
import { curveAt, idSource, unchanged } from './curve-pick';

/** The one field of the numeric input: the distance (label sketch.input.distance). */
const DISTANCE_FIELDS: readonly InputField[] = Object.freeze([
  Object.freeze<InputField>({ id: 'distance', kind: 'length' }),
]);

/** Below this a size is degenerate, like in sketch (spec 12). */
const MIN = 1e-9;

/** What the tool asks the kernel for: the chain picked in `data` and the signed distance. */
interface OffsetKey {
  readonly chain: Chain;
  /** ≠ 0: closed > 0 outwards, open > 0 to the right of the walk (SketchGeometry.offset). */
  readonly distance: number;
  readonly data: SketchData;
}

interface Answer {
  readonly result: readonly OffsetCurve2[];
  /** The curves of the offset as pairs of plane points. */
  readonly preview: readonly Vec2[];
}

interface Request {
  readonly key: OffsetKey;
  readonly answer: Promise<Answer | null>;
}

export function createOffsetTool(sketches: SketchEditor): Tool {
  /** The last request; an answer of an older one draws no preview. */
  let latest: Request | null = null;
  /** The key of the last move, so a late answer draws the preview only where it belongs. */
  let hover: OffsetKey | null = null;
  /** The distance of the last move, shown in the free field of the numeric input. */
  let shown: number | null = null;

  function request(session: SketchSession, key: OffsetKey): Request {
    const last = latest;
    if (last !== null && sameKey(last.key, key)) return last;
    const next: Request = { key, answer: answerOf(session, key) };
    latest = next;
    return next;
  }

  /** The offset of the chain under the cursor, or null (nothing to offset there). */
  function target(
    ctx: ToolContext,
    session: SketchSession,
    x: number,
    y: number,
    mods: ToolMods,
  ): OffsetKey | null {
    const picked = curveAt(ctx, session, x, y);
    if (picked === null) return null;
    const chain = chainOf(picked.data, picked.entity.id);
    if (chain === null) return null;
    const polylines = chainCurves(picked.data, chain).map(polylineOf);
    const value =
      inputValues(mods).get('distance') ?? remembered(session) ?? firstDistance(polylines);
    if (value === null) return null;
    const positive = chain.closed
      ? !inside(polylines, picked.cursor)
      : rightOf(polylines, picked.cursor);
    return { chain, distance: positive ? value : -value, data: picked.data };
  }

  const tool = clickTool(sketches, {
    reset() {
      latest = null;
      hover = null;
      shown = null;
    },
    inputFields: () => DISTANCE_FIELDS,
    // The field is no position: the cursor stays where it is.
    constrain: (cursor) => cursor,
    measure: () => new Map(shown === null ? [] : [['distance', shown]]),
    onMove(ctx, session, x, y, mods) {
      const key = target(ctx, session, x, y, mods);
      hover = key;
      shown = key === null ? null : Math.abs(key.distance);
      if (key === null) {
        clearPreview(ctx);
        return;
      }
      const req = request(session, key);
      void req.answer.then((answer) => {
        // Only the answer of the last request, while the cursor is still over that chain and side.
        if (latest !== req || hover === null || !sameKey(hover, key)) return;
        if (answer === null) clearPreview(ctx);
        else previewPairs(ctx, session, answer.preview);
      });
    },
    onClick(ctx, session, x, y, mods) {
      const key = target(ctx, session, x, y, mods);
      hover = null;
      clearPreview(ctx);
      if (key === null) return;
      const req = request(session, key);
      void req.answer.then(async (answer) => {
        if (answer === null || !unchanged(session, key.data)) return;
        const edit = offsetEdit(key.data, requestOf(key, answer.result), idSource(ctx));
        if (edit === null) return;
        const opened = edit.edit;
        if (opened === undefined) {
          await session.rewrite(edit.data, edit.added);
          return;
        }
        if (await session.rewrite(edit.data, edit.added, { edit: opened })) {
          remember(session, Math.abs(key.distance), opened);
        }
      });
    },
  });
  return withHint(tool, 'hint.offset.pick');
}

function requestOf(key: OffsetKey, result: readonly OffsetCurve2[]) {
  return { chain: key.chain, distance: key.distance, result };
}

function sameKey(a: OffsetKey, b: OffsetKey): boolean {
  return (
    a.distance === b.distance &&
    a.data.entities === b.data.entities &&
    a.data.constraints === b.data.constraints &&
    a.chain.closed === b.chain.closed &&
    a.chain.curves.length === b.chain.curves.length &&
    a.chain.curves.every((c, i) => {
      const d = b.chain.curves[i];
      return d !== undefined && c.id === d.id && c.reversed === d.reversed;
    })
  );
}

/** The answer of the kernel checked by the edit with ids that are never written. */
async function answerOf(session: SketchSession, key: OffsetKey): Promise<Answer | null> {
  let result: readonly OffsetCurve2[];
  try {
    result = await session.geometry.offset(
      chainCurves(key.data, key.chain),
      key.chain.closed,
      key.distance,
    );
  } catch {
    // The kernel failed (an impossible offset, or not running): nothing to offer.
    return null;
  }
  if (!unchanged(session, key.data)) return null;
  if (offsetEdit(key.data, requestOf(key, result), previewIds()) === null) return null;
  return { result, preview: result.flatMap(curvePairs) };
}

/** The whole curve as a polyline along its direction. */
function polylineOf(c: Curve2): readonly Vec2[] {
  const [lo, hi] = paramRange(c);
  return piecePolyline(c, lo, hi);
}

/**
 * The first distance (spec 12): 10 % of the smaller size of the bounding box of the chain,
 * rounded to 2 significant digits; a chain flat in one direction (a single line) takes the
 * larger size. Null for a degenerate chain.
 */
function firstDistance(polylines: readonly (readonly Vec2[])[]): number | null {
  const points = polylines.flat();
  if (points.length === 0) return null;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const smaller = Math.min(w, h);
  const size = smaller > MIN ? smaller : Math.max(w, h);
  if (!(size > MIN)) return null;
  return Number((size / 10).toPrecision(2));
}

/** Whether p lies inside the closed polygon of the polylines in their order (even-odd rule). */
function inside(polylines: readonly (readonly Vec2[])[], p: Vec2): boolean {
  const polygon = polylines.flat();
  let odd = false;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length] ?? a;
    if (a[1] > p[1] !== b[1] > p[1]) {
      const x = a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (p[0] < x) odd = !odd;
    }
  });
  return odd;
}

/** Whether p lies right of the nearest segment of the polylines along their direction. */
function rightOf(polylines: readonly (readonly Vec2[])[], p: Vec2): boolean {
  let nearest = Infinity;
  let side = 0;
  for (const line of polylines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      if (a === undefined || b === undefined) continue;
      const ab: Vec2 = [b[0] - a[0], b[1] - a[1]];
      const ap: Vec2 = [p[0] - a[0], p[1] - a[1]];
      const len2 = ab[0] * ab[0] + ab[1] * ab[1];
      if (len2 <= MIN * MIN) continue;
      const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / len2));
      const d = Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1]);
      if (d < nearest) {
        nearest = d;
        side = ab[0] * ap[1] - ab[1] * ap[0];
      }
    }
  }
  return side < 0;
}

// ---- The distance last used in the session ----

interface Remembered {
  readonly value: number;
  /** The offset dimension that got the value: its current value is the one used last. */
  readonly dimension: SketchConstraintId;
}

/**
 * The distance last used, per session (like the radius of the fillet): the tools are created anew
 * on every activation, the value outlives a switch of the tool within the session (spec 12).
 */
const memory = new WeakMap<SketchSession, Remembered>();

function remember(session: SketchSession, value: number, dimension: SketchConstraintId): void {
  memory.set(session, { value, dimension });
}

/** The last distance of the session (the current value of its dimension while it exists), or null. */
function remembered(session: SketchSession): number | null {
  const last = memory.get(session);
  if (last === undefined) return null;
  const dim = session.state.get().constraints.find((c) => c.id === last.dimension);
  return dim !== undefined && isDimension(dim) ? dim.value : last.value;
}
