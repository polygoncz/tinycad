// The viewport port (spec 10, "Port viewportu"): what interaction needs from a 3D view.
// interaction defines it because it is the consumer; render implements it and imports
// only these types. No DOM types here: adapters convert DOM events into ViewPointerEvent
// and ViewKeyEvent before they reach interaction (ring 2, ADR 0009).

import type { Plane, Subscribable, Vec2, Vec3 } from '@/core';
import type { BodyId } from '@/document';

export interface ViewportPort {
  /**
   * Coordinates in px relative to the view area; null = nothing under the cursor.
   * The filter says what can be hit, default ['edge', 'face']; an empty one gives null
   * without asking the scene. Its order has no meaning: an edge wins over a face.
   */
  pick(x: number, y: number, filter?: PickFilter): PickResult | null;
  screenToRay(x: number, y: number): { readonly origin: Vec3; readonly direction: Vec3 };
  /** Hover and selection. */
  readonly highlight: HighlightPort;
  /** Temporary geometry of tools. */
  readonly overlay: OverlayPort;
  /** Drawings of sketches and planes, pickable as 'sketchEntity' (M12). */
  readonly sketches: SketchPort;
  readonly events: Subscribable<ViewportEvents>;
}

/**
 * What pick can hit; 'sketchEntity' since M12 (not in the default filter), M14 adds 'vertex'.
 */
export type PickKind = 'face' | 'edge' | 'sketchEntity';

/** Kinds pick may return, in any order; empty = nothing can be picked. */
export type PickFilter = readonly PickKind[];

export interface ViewportEvents {
  readonly pointer: ViewPointerEvent;
  readonly key: ViewKeyEvent;
}

/**
 * What can be highlighted: a face or an edge of a body, without point and normal (Q065), or an
 * entity of a sketch drawing (M12). HighlightPort ignores the latter for now: the style of the
 * drawing carries its highlight.
 */
export type HighlightTarget =
  | { readonly kind: 'face'; readonly body: BodyId; readonly faceIndex: number }
  | { readonly kind: 'edge'; readonly body: BodyId; readonly edgeIndex: number }
  | { readonly kind: 'sketchEntity'; readonly sketch: string; readonly entity: string };

/**
 * A HighlightTarget plus where it was hit, so it can be passed to setHover as it is.
 * Defined only here; spec 09 refers to it (Q057). A vertex variant comes when needed.
 */
export type PickResult =
  | {
      readonly kind: 'face';
      readonly body: BodyId;
      readonly faceIndex: number;
      readonly point: Vec3;
      /** Unit normal in world space, pointing out of the body. */
      readonly normal: Vec3;
    }
  | {
      readonly kind: 'edge';
      readonly body: BodyId;
      readonly edgeIndex: number;
      readonly point: Vec3;
    }
  | {
      readonly kind: 'sketchEntity';
      /** Id of the drawing (SketchPort.set). */
      readonly sketch: string;
      /** Id of the point or curve in the drawing. */
      readonly entity: string;
      readonly point: Vec3;
    };

/**
 * A mirror of the state interaction holds: every call passes the whole state (Q058).
 * Takes HighlightTarget because the selection does not know the hit point (Q065).
 */
export interface HighlightPort {
  setHover(target: HighlightTarget | null): void;
  /** Empty array = nothing selected. */
  setSelection(targets: readonly HighlightTarget[]): void;
}

export type OverlayStyle = 'preview' | 'construction';

/** Platform-neutral shapes in world coordinates; no Three.js types (Q058). */
export type OverlayShape =
  | {
      readonly kind: 'lines';
      /** Pairs of points = segments (even length). */
      readonly points: readonly Vec3[];
      readonly style: OverlayStyle;
    }
  | { readonly kind: 'points'; readonly points: readonly Vec3[]; readonly style: OverlayStyle };

export interface OverlayPort {
  /** Replaces everything under the id. */
  set(id: string, shapes: readonly OverlayShape[]): void;
  /** Unknown id = no-op. */
  remove(id: string): void;
  clear(): void;
}

/** Style of a sketch drawing element; render picks the colour (spec 09, "Skici"). */
export type SketchStyle = 'normal' | 'defined' | 'construction' | 'hover' | 'selected' | 'plane';

/** A curve of a drawing in the 2D coordinates of its plane. */
export type SketchDrawingCurve =
  | {
      readonly kind: 'line';
      readonly id: string;
      readonly from: Vec2;
      readonly to: Vec2;
      readonly style: SketchStyle;
    }
  | {
      readonly kind: 'arc';
      readonly id: string;
      readonly center: Vec2;
      readonly radius: number;
      /** Counter-clockwise from startAngle to endAngle > startAngle; a full circle = +2π. */
      readonly startAngle: number;
      readonly endAngle: number;
      readonly style: SketchStyle;
    };

export interface SketchDrawingPoint {
  readonly id: string;
  readonly at: Vec2;
  readonly style: SketchStyle;
}

/** A sketch or a plane as platform-neutral data: a plane plus 2D shapes with styles. */
export interface SketchDrawing {
  readonly plane: Plane;
  readonly curves: readonly SketchDrawingCurve[];
  readonly points: readonly SketchDrawingPoint[];
}

/** A mirror like the overlay, but with entity ids and pickable (render tessellates it). */
export interface SketchPort {
  /** Replaces the drawing under the id. */
  set(id: string, drawing: SketchDrawing): void;
  /** Unknown id = no-op. */
  remove(id: string): void;
}

/**
 * Sent for all buttons; right and middle also drive the camera, tools ignore them.
 * The wheel is never sent, it belongs to the camera only.
 */
export interface ViewPointerEvent {
  /** leave = the cursor left the view area (clears hover). */
  readonly type: 'down' | 'move' | 'up' | 'leave';
  readonly x: number;
  readonly y: number;
  readonly button: 'left' | 'middle' | 'right' | null;
  readonly mods: KeyMods;
}

export interface ViewKeyEvent {
  /** Value of KeyboardEvent.key. */
  readonly key: string;
  readonly mods: KeyMods;
  /** Focus in a text field → shortcuts are ignored. */
  readonly inTextField: boolean;
}

export interface KeyMods {
  readonly shift: boolean;
  readonly alt: boolean;
  /** Cmd on Mac, Ctrl elsewhere. */
  readonly mod: boolean;
}
