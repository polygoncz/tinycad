// Shared parts of the fillet and chamfer tools (spec 12, "Zaoblení a sražení ve skice (M34)"):
// the pick of two lines or arcs (a click on their corner, or two curves one after another), the
// radius or distance last used in the session, and the tool itself: the kernel is asked
// asynchronously for the geometry of the pair under the cursor (the last request wins), the
// preview shows the new curve, a click writes the edit by SketchSession.rewrite and opens its
// dimension. The hint HUD (M35) asks for the first curve (or a corner), then for the second one.

import type { Vec2 } from '@/core';
import {
  isCurveEntity,
  cornerOf,
  curve2,
  edgeLength,
  endIds,
  isDimension,
  isFilletEdge,
  nearestParam,
  pointAt,
  pointsById,
} from '@/sketch';
import type {
  FilletEdge,
  IdSource,
  SketchConstraintId,
  SketchData,
  SketchEdit,
  SketchEntity,
  SketchEntityId,
  SketchGeometry,
} from '@/sketch';
import type { Tool, ToolContext } from '@/interaction';
import { isPlainEscape } from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';
import {
  clearPreview,
  clickTool,
  curvePairs,
  cursorAt,
  distance,
  previewIds,
  previewPairs,
} from './common';
import { idSource, unchanged } from './curve-pick';
import { entityAt } from './snap';

/** Two lines or arcs the user picked. */
export interface PickedPair {
  /** For a click on a corner the curve nearer the cursor, else the first picked curve. */
  readonly a: FilletEdge;
  readonly b: FilletEdge;
  /** The end point a and b share as a corner (cornerOf), or null. */
  readonly corner: SketchEntityId | null;
  /** True for a click on the corner point, false for two curves. */
  readonly clickedCorner: boolean;
  /** The middle of the two clicks (two curves) or the cursor (a corner). */
  readonly near: Vec2;
  /** The data the pair was picked in. */
  readonly data: SketchData;
}

/** What a tool asks the kernel for: the pair and the radius or distance. */
export interface CornerKey {
  readonly pair: PickedPair;
  readonly value: number;
}

/** The values remembered in a session: one for fillets, one for both chamfers. */
export type MemoryKind = 'fillet' | 'chamfer';

/** The hint keys of a tool (M35): before the first curve (or a corner) and after it. */
export interface CornerHints {
  readonly first: string;
  readonly second: string;
}

/** What makes the fillet or chamfer tool. */
export interface CornerToolSpec<K extends CornerKey, A> {
  readonly memory: MemoryKind;
  readonly hints: CornerHints;
  /** The request of the pair with the value, or null when the tool offers nothing for it. */
  key(pair: PickedPair, value: number): K | null;
  /** Whether two keys ask the same (beyond the pair and the value, which are compared already). */
  sameRest(a: K, b: K): boolean;
  /** Asks the kernel; null or a rejection = nothing to offer. */
  answer(geometry: SketchGeometry, key: K): Promise<A | null>;
  /** The edit of the answer (filletEdit, chamferEdit). */
  edit(key: K, answer: A, ids: IdSource): SketchEdit | null;
}

interface Answer<A> {
  readonly input: A;
  /** The new curves of the edit as pairs of plane points. */
  readonly preview: readonly Vec2[];
}

interface Request<K, A> {
  readonly key: K;
  readonly answer: Promise<Answer<A> | null>;
}

/** The first picked curve of a pair of two curves. */
interface FirstPick {
  readonly id: SketchEntityId;
  readonly at: Vec2;
}

/** What is under the cursor: a corner (with its pair), a line or an arc, or nothing. */
type Under =
  | { readonly kind: 'corner'; readonly pair: PickedPair }
  | {
      readonly kind: 'edge';
      readonly edge: FilletEdge;
      readonly at: Vec2;
      readonly data: SketchData;
    };

export function createCornerTool<K extends CornerKey, A>(
  sketches: SketchEditor,
  spec: CornerToolSpec<K, A>,
): Tool {
  let first: FirstPick | null = null;
  /** The last request; an answer of an older one draws no preview. */
  let latest: Request<K, A> | null = null;
  /** The key of the last move, so a late answer draws the preview only where it belongs. */
  let hover: K | null = null;
  /** The ctx of the activation, for the hint; null when inactive. */
  let hintCtx: ToolContext | null = null;

  /** The hint of the current step: the first curve or the second one. */
  function showHint(): void {
    hintCtx?.setHint({ key: first === null ? spec.hints.first : spec.hints.second });
  }

  const same = (a: K, b: K): boolean => sameKey(a, b) && spec.sameRest(a, b);

  function request(session: SketchSession, key: K): Request<K, A> {
    const last = latest;
    if (last !== null && same(last.key, key)) return last;
    const next: Request<K, A> = { key, answer: answerOf(session, spec, key) };
    latest = next;
    return next;
  }

  /** The key of the pair under the cursor and what is there. */
  function target(
    ctx: ToolContext,
    session: SketchSession,
    x: number,
    y: number,
  ): { readonly key: K | null; readonly under: Under | null } {
    const under = underCursor(ctx, session, x, y);
    const pair = under === null ? null : pairOf(under, first);
    if (pair === null) return { key: null, under };
    const value = valueOf(session, spec.memory, pair);
    return { key: value === null ? null : spec.key(pair, value), under };
  }

  /** Without a pair: the first picked curve stays visible, else nothing. */
  function showFirst(ctx: ToolContext, session: SketchSession): void {
    const picked = first === null ? undefined : session.state.get().entities.find(byId(first.id));
    if (!isFilletEdge(picked)) {
      clearPreview(ctx);
      return;
    }
    const { entities, constraints } = session.state.get();
    previewPairs(ctx, session, curvePairs(curve2(picked, pointsById({ entities, constraints }))));
  }

  const tool = clickTool(sketches, {
    reset() {
      first = null;
      latest = null;
      hover = null;
      showHint();
    },
    onMove(ctx, session, x, y) {
      const { key } = target(ctx, session, x, y);
      hover = key;
      if (key === null) {
        showFirst(ctx, session);
        return;
      }
      const req = request(session, key);
      void req.answer.then((answer) => {
        // Only the answer of the last request, while the cursor is still over that pair.
        if (latest !== req || hover === null || !same(hover, key)) return;
        if (answer === null) showFirst(ctx, session);
        else previewPairs(ctx, session, answer.preview);
      });
    },
    onClick(ctx, session, x, y) {
      const { key, under } = target(ctx, session, x, y);
      hover = null;
      if (key === null) {
        // A curve starts a pair of two curves; anything else forgets the first one.
        first = under?.kind === 'edge' ? { id: under.edge.id, at: under.at } : null;
        showHint();
        showFirst(ctx, session);
        return;
      }
      first = null;
      showHint();
      clearPreview(ctx);
      const req = request(session, key);
      void req.answer.then(async (answer) => {
        if (answer === null || !unchanged(session, key.pair.data)) return;
        const edit = spec.edit(key, answer.input, idSource(ctx));
        if (edit === null) return;
        const opened = edit.edit;
        if (opened === undefined) {
          await session.rewrite(edit.data, edit.added);
          return;
        }
        if (await session.rewrite(edit.data, edit.added, { edit: opened })) {
          remember(session, spec.memory, key.value, opened);
        }
      });
    },
    onKey(ctx, session, e) {
      if (!isPlainEscape(e) || first === null) return false;
      first = null;
      hover = null;
      showHint();
      clearPreview(ctx);
      return true;
    },
  });

  return {
    ...tool,
    activate(ctx) {
      tool.activate(ctx);
      hintCtx = ctx;
      showHint();
    },
    deactivate() {
      // Before the reset of clickTool: a deactivated tool shows no hint.
      hintCtx = null;
      tool.deactivate();
    },
  };
}

function sameKey(a: CornerKey, b: CornerKey): boolean {
  const p = a.pair;
  const q = b.pair;
  return (
    a.value === b.value &&
    p.a.id === q.a.id &&
    p.b.id === q.b.id &&
    p.corner === q.corner &&
    p.clickedCorner === q.clickedCorner &&
    // On a corner the cursor only orders a and b (compared above).
    (p.clickedCorner || (p.near[0] === q.near[0] && p.near[1] === q.near[1])) &&
    p.data.entities === q.data.entities &&
    p.data.constraints === q.data.constraints
  );
}

/** The answer of the kernel checked by the edit with ids that are never written. */
async function answerOf<K extends CornerKey, A>(
  session: SketchSession,
  spec: CornerToolSpec<K, A>,
  key: K,
): Promise<Answer<A> | null> {
  let input: A | null;
  try {
    input = await spec.answer(session.geometry, key);
  } catch {
    // The kernel failed (no solution, or not running): nothing to offer.
    return null;
  }
  if (input === null || !unchanged(session, key.pair.data)) return null;
  const edit = spec.edit(key, input, previewIds());
  if (edit === null) return null;
  return { input, preview: newCurves(key.pair.data, edit.data) };
}

/** The curves of `after` not in `before` (the fillet arc, the chamfer line) as pairs of points. */
function newCurves(before: SketchData, after: SketchData): readonly Vec2[] {
  const old = new Set<string>(before.entities.map((e) => e.id));
  const points = pointsById(after);
  return after.entities.flatMap((e) =>
    !isCurveEntity(e) || old.has(e.id) ? [] : curvePairs(curve2(e, points)),
  );
}

const byId =
  (id: string) =>
  (e: SketchEntity): boolean =>
    e.id === id;

/** A corner point (cornerOf) or a line or an arc under the cursor; null for anything else. */
function underCursor(ctx: ToolContext, session: SketchSession, x: number, y: number): Under | null {
  const entity = entityAt(ctx, session, x, y);
  const at = cursorAt(ctx, session, x, y);
  if (entity === null || at === null) return null;
  const { entities, constraints } = session.state.get();
  const data: SketchData = { entities, constraints };
  if (entity.kind === 'point') {
    const corner = cornerOf(data, entity.id);
    if (corner === null) return null;
    const ca = entities.find(byId(corner.a));
    const cb = entities.find(byId(corner.b));
    if (!isFilletEdge(ca) || !isFilletEdge(cb)) return null;
    // The curve nearer the cursor first (the reference of a chamfer with an angle, spec 12).
    const [a, b] = distanceTo(ca, at, data) <= distanceTo(cb, at, data) ? [ca, cb] : [cb, ca];
    return {
      kind: 'corner',
      pair: { a, b, corner: entity.id, clickedCorner: true, near: at, data },
    };
  }
  return isFilletEdge(entity) ? { kind: 'edge', edge: entity, at, data } : null;
}

/** The pair of what is under the cursor: a corner, or the first picked curve and another one. */
function pairOf(under: Under, first: FirstPick | null): PickedPair | null {
  if (under.kind === 'corner') return under.pair;
  if (first === null || first.id === under.edge.id) return null;
  const a = under.data.entities.find(byId(first.id));
  if (!isFilletEdge(a)) return null;
  const b = under.edge;
  const near: Vec2 = [(first.at[0] + under.at[0]) / 2, (first.at[1] + under.at[1]) / 2];
  const corner = sharedCorner(under.data, a, b, near);
  return { a, b, corner, clickedCorner: false, near, data: under.data };
}

/**
 * The end a and b share as a corner (cornerOf names both): the tool sends it whenever there is
 * one, so the corner and its dimensions stay (spec 12). Of two such ends the one nearer `near`.
 */
function sharedCorner(
  data: SketchData,
  a: FilletEdge,
  b: FilletEdge,
  near: Vec2,
): SketchEntityId | null {
  const points = pointsById(data);
  let best: { readonly id: SketchEntityId; readonly d: number } | null = null;
  for (const end of endIds(a)) {
    if (!endIds(b).includes(end)) continue;
    const corner = cornerOf(data, end);
    if (corner === null || ![a.id, b.id].every((id) => id === corner.a || id === corner.b)) {
      continue;
    }
    const p = points.get(end);
    const d = p === undefined ? Infinity : distance([p.x, p.y], near);
    if (best === null || d < best.d) best = { id: end, d };
  }
  return best?.id ?? null;
}

function distanceTo(e: FilletEdge, p: Vec2, data: SketchData): number {
  const c = curve2(e, pointsById(data));
  return distance(pointAt(c, nearestParam(c, p)), p);
}

// ---- The value last used in the session ----

interface Remembered {
  readonly value: number;
  /** The dimension that got the value: its current value is the one used last. */
  readonly dimension: SketchConstraintId;
}

/**
 * The radius and the distance last used, per session: the tools are created anew on every
 * activation, the value outlives a switch of the tool within the session (spec 12).
 */
const memory = new WeakMap<SketchSession, Map<MemoryKind, Remembered>>();

function remember(
  session: SketchSession,
  kind: MemoryKind,
  value: number,
  dimension: SketchConstraintId,
): void {
  const values = memory.get(session) ?? new Map<MemoryKind, Remembered>();
  values.set(kind, { value, dimension });
  memory.set(session, values);
}

/**
 * The value for the pair: the last used in the session (the current value of its dimension while
 * it exists, so an edited radius is used next), the first time ¼ of the shorter curve rounded to
 * 2 significant digits. Null for a degenerate curve.
 */
function valueOf(session: SketchSession, kind: MemoryKind, pair: PickedPair): number | null {
  const last = memory.get(session)?.get(kind);
  if (last !== undefined) {
    const dim = session.state.get().constraints.find((c) => c.id === last.dimension);
    return dim !== undefined && isDimension(dim) ? dim.value : last.value;
  }
  const shorter = Math.min(edgeLength(pair.data, pair.a), edgeLength(pair.data, pair.b));
  if (!(shorter > 0)) return null;
  return Number((shorter / 4).toPrecision(2));
}
