// Shared parts of the sketcher tools (spec 10, "Nástroje a akce skicáře"): the open session,
// clicks, the cursor in plane coordinates and the preview overlay.

import { plane as planeMath } from '@/core';
import type { Vec2, Vec3 } from '@/core';
import type { SketchConstraintId, SketchEntityId } from '@/sketch';
import { CLICK_TOLERANCE_PX } from '@/interaction';
import type {
  KeyMods,
  OverlayShape,
  Tool,
  ToolContext,
  ViewKeyEvent,
  ViewPointerEvent,
} from '@/interaction';
import type { SketchEditor } from '../sketch-editor';
import type { SketchSession } from '../sketch-session';

/** The overlay id of the preview of the drawing tools. */
export const PREVIEW_OVERLAY_ID = 'sketch-tool';

/** Below this a length or a radius is degenerate (like a measured dimension, spec 12). */
export const MIN_LENGTH = 1e-9;

/** Segments of a full turn in the preview of circles and arcs. */
const PREVIEW_SEGMENTS = 64;

const FULL_TURN = 2 * Math.PI;

/** The open session of the editor, or null; a closed session counts as none (spec 10). */
export function openSession(sketches: SketchEditor): SketchSession | null {
  const session = sketches.current.get();
  return session !== null && session.state.get().open ? session : null;
}

// Ids are minted here from the generator of the tool context: the trusted place for new ids.
export const newEntityId = (ctx: ToolContext): SketchEntityId => ctx.ids.next() as SketchEntityId;
export const newConstraintId = (ctx: ToolContext): SketchConstraintId =>
  ctx.ids.next() as SketchConstraintId;

/**
 * The grid step a drawing tool snaps to (M19.2 D4): the current step of the editor while the snap
 * is on and Alt is not held, otherwise null (no grid). Read on every move and click.
 */
export function snapGrid(sketches: SketchEditor, mods: KeyMods): number | null {
  return sketches.gridSnap.get() && !mods.alt ? sketches.gridStep() : null;
}

/** The cursor in the coordinates of the plane of the session; null for a ray parallel to it. */
export function cursorAt(
  ctx: ToolContext,
  session: SketchSession,
  x: number,
  y: number,
): Vec2 | null {
  const plane = session.plane.get();
  const world = planeMath.intersectRay(plane, ctx.viewport.screenToRay(x, y));
  return world === null ? null : planeMath.toLocal(plane, world);
}

export const toWorld = (session: SketchSession, v: Vec2): Vec3 =>
  planeMath.toWorld(session.plane.get(), v);

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Lines between consecutive points as overlay pairs (a polyline). */
function polylinePairs(points: readonly Vec3[]): readonly Vec3[] {
  return points.slice(1).flatMap((p, i) => {
    const prev = points[i];
    return prev === undefined ? [] : [prev, p];
  });
}

/** Sets the preview: lines given as pairs of plane points. */
export function previewPairs(
  ctx: ToolContext,
  session: SketchSession,
  pairs: readonly Vec2[],
): void {
  const shape: OverlayShape = {
    kind: 'lines',
    points: pairs.map((p) => toWorld(session, p)),
    style: 'preview',
  };
  ctx.viewport.overlay.set(PREVIEW_OVERLAY_ID, [shape]);
}

/** Sets the preview: a closed or open polyline through the plane points. */
export function previewPolyline(
  ctx: ToolContext,
  session: SketchSession,
  points: readonly Vec2[],
): void {
  const shape: OverlayShape = {
    kind: 'lines',
    points: polylinePairs(points.map((p) => toWorld(session, p))),
    style: 'preview',
  };
  ctx.viewport.overlay.set(PREVIEW_OVERLAY_ID, [shape]);
}

/**
 * Points of a counter-clockwise arc from `from` by `sweep` radians, with 64 segments per full turn
 * (at least one); both ends included.
 */
export function arcPoints(center: Vec2, radius: number, from: number, sweep: number): Vec2[] {
  const segments = Math.max(1, Math.ceil((PREVIEW_SEGMENTS * sweep) / FULL_TURN));
  return Array.from({ length: segments + 1 }, (_, i): Vec2 => {
    const angle = from + (sweep * i) / segments;
    return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
  });
}

export const circlePoints = (center: Vec2, radius: number): Vec2[] =>
  arcPoints(center, radius, 0, FULL_TURN);

/** The counter-clockwise sweep from angle a to angle b in (0, 2π]. */
export function ccwSweep(a: number, b: number): number {
  let sweep = b - a;
  while (sweep <= 0) sweep += FULL_TURN;
  while (sweep > FULL_TURN) sweep -= FULL_TURN;
  return sweep;
}

export function clearPreview(ctx: ToolContext): void {
  ctx.viewport.overlay.remove(PREVIEW_OVERLAY_ID);
}

/** What a drawing tool reacts to; every call has an open session. */
export interface ClickHandlers {
  /** The cursor moved (preview); the modifiers decide the grid snap (Alt = off, M19.2 D4). */
  onMove?(ctx: ToolContext, session: SketchSession, x: number, y: number, mods: KeyMods): void;
  /** A left click (up within the click tolerance of its down). */
  onClick(ctx: ToolContext, session: SketchSession, x: number, y: number, mods: KeyMods): void;
  /** Escape etc.; true = handled. */
  onKey?(ctx: ToolContext, session: SketchSession, e: ViewKeyEvent): boolean;
  /** Forgets the work in progress (deactivate, another session). */
  reset(): void;
}

/**
 * A tool of clicks over the open session. Without an open session it does nothing; a new session
 * resets the work in progress (it belonged to the old one). Deactivate removes the preview.
 */
export function clickTool(sketches: SketchEditor, handlers: ClickHandlers): Tool {
  let ctx: ToolContext | null = null;
  let down: { readonly x: number; readonly y: number } | null = null;
  let owner: SketchSession | null = null;

  /** The open session; resets the handlers when it is another one than before. */
  function current(): SketchSession | null {
    const session = openSession(sketches);
    if (session !== owner) {
      owner = session;
      down = null;
      handlers.reset();
      if (ctx !== null) clearPreview(ctx);
    }
    return session;
  }

  return {
    activate(c) {
      ctx = c;
      owner = openSession(sketches);
    },
    deactivate() {
      if (ctx !== null) clearPreview(ctx);
      handlers.reset();
      ctx = null;
      owner = null;
      down = null;
    },
    onPointer(e: ViewPointerEvent) {
      const c = ctx;
      if (c === null) return;
      const session = current();
      if (session === null) return;
      switch (e.type) {
        case 'move':
          handlers.onMove?.(c, session, e.x, e.y, e.mods);
          return;
        case 'leave':
          return;
        case 'down':
          if (e.button === 'left') down = { x: e.x, y: e.y };
          return;
        case 'up': {
          if (e.button !== 'left') return;
          const start = down;
          down = null;
          if (start === null) return;
          if (Math.hypot(e.x - start.x, e.y - start.y) > CLICK_TOLERANCE_PX) return;
          handlers.onClick(c, session, e.x, e.y, e.mods);
          return;
        }
      }
    },
    onKey(e) {
      const c = ctx;
      if (c === null) return false;
      const session = current();
      if (session === null) return false;
      return handlers.onKey?.(c, session, e) ?? false;
    },
  };
}
