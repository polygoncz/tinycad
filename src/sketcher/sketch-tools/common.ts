// Shared parts of the sketcher tools (spec 10, "Nástroje a akce skicáře"): the open session,
// clicks, the cursor in plane coordinates and the preview overlay.

import { plane as planeMath } from '@/core';
import type { Vec2, Vec3 } from '@/core';
import type {
  SketchConstraintId,
  SketchData,
  SketchEntity,
  SketchEntityId,
  SnapGuide,
} from '@/sketch';
import { CLICK_TOLERANCE_PX, isPlainEscape } from '@/interaction';
import type {
  KeyMods,
  OverlayShape,
  Tool,
  ToolContext,
  ViewKeyEvent,
  ViewPointerEvent,
} from '@/interaction';
import {
  emptyInput,
  inputFieldViews,
  inputKey,
  lockedValues,
  previewValues,
} from '../numeric-input';
import type { InputField, NumericInput } from '../numeric-input';
import type { SketchEditor } from '../sketch-editor';
import { ccwSweep } from '../sketch-angles';
import type { GlyphKind } from '../sketch-glyphs';
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
 * Writes the geometry of a drawing tool (M31, spec 12 "Režim konstrukce"): in the construction
 * mode of the session every curve of `add` becomes construction (points and constraints as they
 * are), then session.addGeometry. Only the drawing tools write through it, so the mode never
 * turns the curves of other edits (trim, mirror) into construction.
 */
export function addDrawn(
  session: SketchSession,
  add: SketchData,
  opts?: { readonly required?: ReadonlySet<SketchConstraintId> },
): Promise<boolean> {
  const data = session.state.get().constructionMode ? asConstruction(add) : add;
  return opts === undefined ? session.addGeometry(data) : session.addGeometry(data, opts);
}

/** The data with every curve construction; points and constraints unchanged. */
function asConstruction(add: SketchData): SketchData {
  return Object.freeze({
    entities: Object.freeze(
      add.entities.map((e): SketchEntity =>
        e.kind === 'point' || e.construction === true
          ? e
          : Object.freeze({ ...e, construction: true }),
      ),
    ),
    constraints: add.constraints,
  });
}

/**
 * The point of the numeric input (spec 12, "Číselný vstup (M32)"): the cursor constrained by the
 * entered values (ClickHandlers.constrain) and those values by field id (a length in mm, an angle
 * in radians).
 */
export interface InputPoint {
  readonly at: Vec2;
  readonly values: ReadonlyMap<string, number>;
}

/**
 * The modifiers of a move or a click of clickTool; `input` = the entered values constrain the
 * point (M32): snapMode passes it on, so snapAt returns it as a free target.
 */
export interface ToolMods extends KeyMods {
  readonly input?: InputPoint;
}

/**
 * The grid step a drawing tool snaps to (M19.2 D4): the current step of the editor while the snap
 * is on and Alt is not held, otherwise null (no grid). Read on every move and click.
 */
export function snapGrid(sketches: SketchEditor, mods: KeyMods): number | null {
  return sketches.gridSnap.get() && !mods.alt ? sketches.gridStep() : null;
}

/**
 * How a drawing tool snaps (spec 12, M26): the grid of snapGrid and the inference of constraints,
 * which Ctrl/Cmd turns off. Read on every move and click.
 */
export function snapMode(
  sketches: SketchEditor,
  mods: ToolMods,
): { readonly grid: number | null; readonly infer: boolean; readonly input?: Vec2 } {
  const mode = { grid: snapGrid(sketches, mods), infer: !mods.mod };
  return mods.input === undefined ? mode : { ...mode, input: mods.input.at };
}

/** The values the click of a tool entered (M32): the locked fields; none without the input. */
export function inputValues(mods: ToolMods): ReadonlyMap<string, number> {
  return mods.input?.values ?? NO_VALUES;
}

const NO_VALUES: ReadonlyMap<string, number> = new Map();

/** The fields of a first point (spec 12, M32): its coordinates in the plane. */
export const XY_FIELDS: readonly InputField[] = Object.freeze([
  Object.freeze({ id: 'x', kind: 'x' }),
  Object.freeze({ id: 'y', kind: 'y' }),
]);

/** The fields of a next point from a previous one (spec 12, M32): the length and the direction. */
export const POLAR_FIELDS: readonly InputField[] = Object.freeze([
  Object.freeze({ id: 'length', kind: 'length' }),
  Object.freeze({ id: 'angle', kind: 'angle' }),
]);

/** The cursor with the entered coordinates `x`, `y` (the others from the cursor). */
export function constrainXY(cursor: Vec2, values: ReadonlyMap<string, number>): Vec2 {
  return [values.get('x') ?? cursor[0], values.get('y') ?? cursor[1]];
}

export function measureXY(at: Vec2): ReadonlyMap<string, number> {
  return new Map([
    ['x', at[0]],
    ['y', at[1]],
  ]);
}

/**
 * The point from `from` for the cursor and the entered `length` and `angle` (spec 12, M32
 * "constrain"): both = the fixed point; the length = the point in the direction of the cursor at
 * that distance (`from` for the cursor on `from`); the angle = the projection of the cursor onto
 * the ray at that angle, `from` for a negative one (a degenerate step).
 */
export function constrainPolar(
  from: Vec2,
  cursor: Vec2,
  values: ReadonlyMap<string, number>,
): Vec2 {
  const length = values.get('length');
  const angle = values.get('angle');
  const d: Vec2 = [cursor[0] - from[0], cursor[1] - from[1]];
  if (angle !== undefined) {
    const dir: Vec2 = [Math.cos(angle), Math.sin(angle)];
    const t = length ?? Math.max(0, d[0] * dir[0] + d[1] * dir[1]);
    return [from[0] + t * dir[0], from[1] + t * dir[1]];
  }
  if (length === undefined) return cursor;
  const size = Math.hypot(d[0], d[1]);
  if (size <= MIN_LENGTH) return from;
  return [from[0] + (length * d[0]) / size, from[1] + (length * d[1]) / size];
}

/** The `length` and the `angle` (in [0, 2π)) from `from` to `at`. */
export function measurePolar(from: Vec2, at: Vec2): ReadonlyMap<string, number> {
  const angle = Math.atan2(at[1] - from[1], at[0] - from[0]);
  return new Map([
    ['length', distance(from, at)],
    ['angle', angle < 0 ? angle + FULL_TURN : angle],
  ]);
}

/** Below this (in degrees) an entered angle is on an axis. */
const AXIS_ANGLE_TOLERANCE_DEG = 1e-9;

/**
 * The axis constraint of an entered angle (spec 12, M32, "Úhel"): 0/180° → horizontal, 90/270° →
 * vertical (any multiple of them); another angle → null.
 */
export function axisOfAngle(angle: number): 'horizontal' | 'vertical' | null {
  const deg = (angle * 180) / Math.PI;
  const half = ((deg % 180) + 180) % 180;
  const near = (v: number): boolean => Math.abs(half - v) <= AXIS_ANGLE_TOLERANCE_DEG;
  if (near(0) || near(180)) return 'horizontal';
  if (near(90)) return 'vertical';
  return null;
}

/** The inferred kinds that set the direction of a curve: a locked angle replaces them (M32). */
const DIRECTION_KINDS: ReadonlySet<string> = new Set([
  'horizontal',
  'vertical',
  'parallel',
  'perpendicular',
  'tangent',
]);

/** The inferred kinds that set the size of a curve: a locked size replaces them (M32). */
const SIZE_KINDS: ReadonlySet<string> = new Set(['equal']);

/**
 * The automatic inferences without those a locked field replaces (spec 12, M32; the entered
 * dimensions are exact): a locked direction (an angle) drops horizontal, vertical, parallel,
 * perpendicular and tangent, a locked size (a length, a radius…) drops equal.
 */
export function withoutLocked<T extends { readonly kind: string }>(
  inferences: readonly T[],
  locked: { readonly direction: boolean; readonly size: boolean },
): readonly T[] {
  return inferences.filter(
    (i) =>
      !(locked.direction && DIRECTION_KINDS.has(i.kind)) &&
      !(locked.size && SIZE_KINDS.has(i.kind)),
  );
}

/** A new line within this angle of an axis or of a connected line is inferred (spec 12, 3°). */
export const ANGLE_TOLERANCE = (3 * Math.PI) / 180;

/** The last circle or arc of the data (`previous` of inferRadius, spec 12); null without one. */
export function lastRound(data: SketchData): SketchEntityId | null {
  const round = data.entities.findLast((e) => e.kind === 'circle' || e.kind === 'arc');
  return round?.id ?? null;
}

/**
 * The line of the data between the points a and b (either order), or null. A tool does not draw
 * a second line between two points an existing line already joins.
 */
export function existingLine(
  data: SketchData,
  a: SketchEntityId,
  b: SketchEntityId,
): SketchEntityId | null {
  const line = data.entities.find(
    (e) => e.kind === 'line' && ((e.p1 === a && e.p2 === b) || (e.p1 === b && e.p2 === a)),
  );
  return line?.id ?? null;
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

/**
 * Sets the preview: the arc around `fit.center` of `fit.radius` from a to b, counter-clockwise
 * when `fit.ccw`, otherwise clockwise (M27, the fits of arcFrom3 and tangentArcFrom).
 */
export function previewArcFit(
  ctx: ToolContext,
  session: SketchSession,
  fit: { readonly center: Vec2; readonly radius: number; readonly ccw: boolean },
  a: Vec2,
  b: Vec2,
): void {
  const [from, to] = fit.ccw ? [a, b] : [b, a];
  const begin = angleAt(fit.center, from);
  const sweep = ccwSweep(begin, angleAt(fit.center, to));
  previewPolyline(ctx, session, arcPoints(fit.center, fit.radius, begin, sweep));
}

const angleAt = (center: Vec2, p: Vec2): number => Math.atan2(p[1] - center[1], p[0] - center[0]);

export function clearPreview(ctx: ToolContext): void {
  ctx.viewport.overlay.remove(PREVIEW_OVERLAY_ID);
}

/**
 * The inference preview of a move (spec 12, M26): the kinds of the constraints the click at `at`
 * would add, and the guides of the snap. The kinds come from the same step the click uses.
 */
export function previewInference(
  session: SketchSession,
  at: Vec2,
  inferences: readonly { readonly kind: GlyphKind }[],
  guides: readonly SnapGuide[],
): void {
  session.setInferencePreview({ at, kinds: inferences.map((i) => i.kind), guides });
}

/** Removes the inference preview of a session that is still open. */
export function clearInference(session: SketchSession | null): void {
  if (session?.state.get().open === true) session.setInferencePreview(null);
}

/** What a drawing tool reacts to; every call has an open session. */
export interface ClickHandlers {
  /**
   * The cursor moved (preview); the modifiers decide the grid snap (Alt = off, M19.2 D4). With the
   * entered values (previewValues, M32) mods.input is the constrained point.
   */
  onMove?(ctx: ToolContext, session: SketchSession, x: number, y: number, mods: ToolMods): void;
  /**
   * A left click (up within the click tolerance of its down) or Enter of the numeric input at the
   * last cursor (M32); with locked values mods.input is the constrained point.
   */
  onClick(ctx: ToolContext, session: SketchSession, x: number, y: number, mods: ToolMods): void;
  /** Escape etc.; true = handled. */
  onKey?(ctx: ToolContext, session: SketchSession, e: ViewKeyEvent): boolean;
  /** Forgets the work in progress (deactivate, another session). */
  reset(): void;
  /**
   * A left press moved past the click tolerance (M27, the tangent arc of the polyline), asked once
   * per press with the position of the press; true = the tool takes the drag: its moves go to
   * onDrag instead of onMove and its release to onDragEnd. Without it a drag is ignored.
   */
  onDragStart?(
    ctx: ToolContext,
    session: SketchSession,
    x: number,
    y: number,
    mods: KeyMods,
  ): boolean;
  /** A move of a taken drag (the preview). */
  onDrag?(ctx: ToolContext, session: SketchSession, x: number, y: number, mods: KeyMods): void;
  /** The release of a taken drag. */
  onDragEnd?(ctx: ToolContext, session: SketchSession, x: number, y: number, mods: KeyMods): void;
  /** Escape during a taken drag: the drag is forgotten; the moves until the release are plain moves. */
  onDragCancel?(ctx: ToolContext, session: SketchSession): void;
  /** M32: the fields of the current step; null/[] = a step without input. Asked after every step of the tool. */
  inputFields?(session: SketchSession): readonly InputField[] | null;
  /** M32: the point of the plane for the cursor `cursor` and the entered values: the cursor projected so that it meets them. */
  constrain?(session: SketchSession, cursor: Vec2, values: ReadonlyMap<string, number>): Vec2;
  /** M32: the values of the fields for the point `at` (what the fields would show if not entered). */
  measure?(session: SketchSession, at: Vec2): ReadonlyMap<string, number>;
}

/** Removes the numeric input of a session that is still open. */
function clearNumericInput(session: SketchSession | null): void {
  if (session?.state.get().open === true) session.setNumericInput(null);
}

/** The last cursor of a move over the view: px and the modifiers. */
interface Cursor {
  readonly x: number;
  readonly y: number;
  readonly mods: KeyMods;
}

/**
 * A tool of clicks over the open session. Without an open session it does nothing; a new session
 * resets the work in progress (it belonged to the old one). Deactivate removes the preview; it,
 * a click, Escape and the pointer leaving the view remove the inference preview too (spec 12,
 * M26). A tool with onDragStart may take a drag of the left button instead (M27).
 *
 * The numeric input (spec 12, "Číselný vstup (M32)"): the tool holds the NumericInput of the
 * fields of the current step (inputFields), emptied after every step (a click, Enter, a handled
 * key, the end of a drag, a reset) and when a move finds other fields (a refused write reset the
 * step). A key goes to inputKey first, then to onKey of the handlers.
 * With entered values a move (previewValues) and a click or Enter (lockedValues, at the last
 * cursor) pass the constrained point in mods.input; the fields are shown in
 * SketchState.numericInput at that point (or at the cursor), free ones with the measured values.
 */
export function clickTool(sketches: SketchEditor, handlers: ClickHandlers): Tool {
  let ctx: ToolContext | null = null;
  let down: { readonly x: number; readonly y: number } | null = null;
  /** What the tool said to the drag of the current press; null = not asked yet. */
  let drag: 'taken' | 'refused' | null = null;
  let owner: SketchSession | null = null;
  /** The numeric input of the current step (M32). */
  let input: NumericInput = emptyInput([]);
  /** The last cursor over the view; null before a move and after leaving the view. */
  let cursor: Cursor | null = null;
  /** SketchState.numericInput was set by this tool (cleared once, not on every move). */
  let shown = false;

  /** The open session; resets the handlers when it is another one than before. */
  function current(): SketchSession | null {
    const session = openSession(sketches);
    if (session !== owner) {
      clearInference(owner);
      clearNumericInput(owner);
      owner = session;
      down = null;
      drag = null;
      cursor = null;
      shown = false;
      handlers.reset();
      input = emptyInput(session === null ? [] : fieldsOf(session));
      if (ctx !== null) clearPreview(ctx);
    }
    return session;
  }

  function fieldsOf(session: SketchSession): readonly InputField[] {
    return handlers.inputFields?.(session) ?? [];
  }

  /**
   * The step changed without an event of the tool (a write refused later resets the work in
   * progress): other fields than those of the input empty it.
   */
  function follow(session: SketchSession): void {
    const fields = fieldsOf(session);
    const same =
      fields.length === input.fields.length &&
      fields.every((f, i) => {
        const old = input.fields[i];
        return old !== undefined && f.id === old.id && f.kind === old.kind;
      });
    if (!same) input = emptyInput(fields);
  }

  /** A new step of the tool: the fields asked again, the input empty, shown at the cursor. */
  function restart(c: ToolContext, session: SketchSession): void {
    input = emptyInput(fieldsOf(session));
    show(c, session);
  }

  /** The cursor in the plane and its point constrained by `values` (null off the plane). */
  function pointAt(
    c: ToolContext,
    session: SketchSession,
    at: Cursor,
    values: ReadonlyMap<string, number>,
  ): { readonly cursor: Vec2; readonly input?: InputPoint } | null {
    const plane = cursorAt(c, session, at.x, at.y);
    if (plane === null) return null;
    if (values.size === 0 || handlers.constrain === undefined) return { cursor: plane };
    return { cursor: plane, input: { at: handlers.constrain(session, plane, values), values } };
  }

  /** The modifiers of a move or a click at `at` with the entered `values`. */
  function modsAt(
    c: ToolContext,
    session: SketchSession,
    at: Cursor,
    values: ReadonlyMap<string, number>,
  ): ToolMods {
    const point = pointAt(c, session, at, values);
    return point?.input === undefined ? at.mods : { ...at.mods, input: point.input };
  }

  /** SketchState.numericInput: the fields at the (constrained) cursor, null without fields or a cursor. */
  function show(c: ToolContext, session: SketchSession): void {
    const point =
      cursor === null || input.fields.length === 0
        ? null
        : pointAt(c, session, cursor, previewValues(input));
    if (point === null) {
      if (shown) session.setNumericInput(null);
      shown = false;
      return;
    }
    const at = point.input?.at ?? point.cursor;
    const measured = handlers.measure?.(session, at) ?? new Map<string, number>();
    session.setNumericInput({ at, fields: inputFieldViews(input, measured) });
    shown = true;
  }

  /** The preview of a move at the last cursor with the typed values. */
  function preview(c: ToolContext, session: SketchSession): void {
    const at = cursor;
    if (at !== null && drag !== 'taken') {
      handlers.onMove?.(c, session, at.x, at.y, modsAt(c, session, at, previewValues(input)));
    }
    show(c, session);
  }

  /** A click at `at` with the locked values; the next step starts. */
  function click(c: ToolContext, session: SketchSession, at: Cursor): void {
    // The click adds what the preview showed; the next move shows the next one.
    clearInference(session);
    handlers.onClick(c, session, at.x, at.y, modsAt(c, session, at, lockedValues(input)));
    restart(c, session);
  }

  /** A key of the numeric input; true = spent by it. */
  function inputKeyOf(c: ToolContext, session: SketchSession, e: ViewKeyEvent): boolean {
    if (drag === 'taken') return false;
    const result = inputKey(input, e);
    if (result === null) return false;
    input = result.input;
    // Enter = a click at the last cursor; without one the values only stay locked.
    if (result.commit && cursor !== null) click(c, session, cursor);
    else preview(c, session);
    return true;
  }

  return {
    activate(c) {
      ctx = c;
      owner = openSession(sketches);
      input = emptyInput(owner === null ? [] : fieldsOf(owner));
      cursor = null;
      shown = false;
    },
    deactivate() {
      if (ctx !== null) clearPreview(ctx);
      clearInference(owner);
      if (shown) clearNumericInput(owner);
      handlers.reset();
      ctx = null;
      owner = null;
      down = null;
      drag = null;
      input = emptyInput([]);
      cursor = null;
      shown = false;
    },
    onPointer(e: ViewPointerEvent) {
      const c = ctx;
      if (c === null) return;
      const session = current();
      if (session === null) return;
      switch (e.type) {
        case 'move': {
          const start = down;
          if (
            start !== null &&
            drag === null &&
            handlers.onDragStart !== undefined &&
            Math.hypot(e.x - start.x, e.y - start.y) > CLICK_TOLERANCE_PX
          ) {
            drag = handlers.onDragStart(c, session, start.x, start.y, e.mods) ? 'taken' : 'refused';
          }
          if (drag === 'taken') {
            handlers.onDrag?.(c, session, e.x, e.y, e.mods);
            return;
          }
          cursor = { x: e.x, y: e.y, mods: e.mods };
          follow(session);
          preview(c, session);
          return;
        }
        case 'leave':
          // Off the view the click would add nothing: like Escape, the preview goes.
          clearInference(session);
          cursor = null;
          show(c, session);
          return;
        case 'down':
          if (e.button !== 'left') return;
          down = { x: e.x, y: e.y };
          drag = null;
          return;
        case 'up': {
          if (e.button !== 'left') return;
          const start = down;
          const taken = drag === 'taken';
          down = null;
          drag = null;
          if (start === null) return;
          if (taken) {
            clearInference(session);
            handlers.onDragEnd?.(c, session, e.x, e.y, e.mods);
            restart(c, session);
            return;
          }
          if (Math.hypot(e.x - start.x, e.y - start.y) > CLICK_TOLERANCE_PX) return;
          cursor = { x: e.x, y: e.y, mods: e.mods };
          click(c, session, cursor);
          return;
        }
      }
    },
    onKey(e) {
      const c = ctx;
      if (c === null) return false;
      const session = current();
      if (session === null) return false;
      if (inputKeyOf(c, session, e)) return true;
      if (isPlainEscape(e)) clearInference(session);
      if (isPlainEscape(e) && drag === 'taken') {
        // Only the drag is cancelled; the release that follows is no click.
        down = null;
        drag = null;
        handlers.onDragCancel?.(c, session);
        return true;
      }
      const handled = handlers.onKey?.(c, session, e) ?? false;
      if (handled) restart(c, session);
      return handled;
    },
  };
}
