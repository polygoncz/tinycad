// The viewport port (spec 10, "Port viewportu"): what interaction needs from a 3D view.
// interaction defines it because it is the consumer; render implements it and imports
// only these types. No DOM types here: adapters convert DOM events into ViewPointerEvent
// and ViewKeyEvent before they reach interaction (ring 2, ADR 0009).

import type { Plane, Subscribable, Vec2, Vec3 } from '@/core';
import type { BodyId } from '@/document';
import type { HandleTint } from './manipulators';

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
  /** Drawings of sketches and planes, pickable as 'sketchEntity' (M12) and 'sketchRegion' (M13). */
  readonly sketches: SketchPort;
  /** Handles of manipulators (M18). */
  readonly manipulators: ManipulatorPort;
  /** M19: the projection into px relative to the view area; not mounted → null. */
  project(world: Vec3): readonly [x: number, y: number] | null;
  readonly events: Subscribable<ViewportEvents>;
}

/**
 * What pick can hit; 'sketchEntity' since M12 and 'sketchRegion' since M13 (neither in the
 * default filter); 'vertex' is postponed.
 */
export type PickKind = 'face' | 'edge' | 'sketchEntity' | 'sketchRegion';

/** Kinds pick may return, in any order; empty = nothing can be picked. */
export type PickFilter = readonly PickKind[];

export interface ViewportEvents {
  readonly pointer: ViewPointerEvent;
  readonly key: ViewKeyEvent;
  /** M19: after a drawn frame in which the camera or the size of the view area changed. */
  readonly viewChanged: ViewChangedEvent;
}

/**
 * What can be highlighted: a face or an edge of a body, without point and normal (Q065), an
 * entity of a sketch drawing (M12), a region of a drawing (M13) or a whole body (M14). HighlightPort ignores
 * sketch entities: the style of the drawing carries their highlight; render fills a region.
 */
export type HighlightTarget =
  | { readonly kind: 'face'; readonly body: BodyId; readonly faceIndex: number }
  | { readonly kind: 'edge'; readonly body: BodyId; readonly edgeIndex: number }
  | { readonly kind: 'sketchEntity'; readonly sketch: string; readonly entity: string }
  | {
      readonly kind: 'sketchRegion';
      /** Id of the drawing (SketchPort.set). */
      readonly sketch: string;
      /** Id of the region in the drawing (the region name). */
      readonly region: string;
    }
  /** M14: a whole body (selected in the Browser, bodies references in the dialog, R104). */
  | { readonly kind: 'body'; readonly body: BodyId };

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
    }
  | {
      /** A region of a drawing under the cursor (M13). */
      readonly kind: 'sketchRegion';
      /** Id of the drawing (SketchPort.set). */
      readonly sketch: string;
      /** Id of the region in the drawing (the region name). */
      readonly region: string;
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

/**
 * A region of a drawing (M13): a closed polygon in the plane (the last point is not the first
 * one again), holes as further polygons; id = the region name.
 */
export interface SketchDrawingRegion {
  readonly id: string;
  readonly outer: readonly Vec2[];
  readonly holes: readonly (readonly Vec2[])[];
}

/** A sketch or a plane as platform-neutral data: a plane plus 2D shapes with styles. */
export interface SketchDrawing {
  readonly plane: Plane;
  readonly curves: readonly SketchDrawingCurve[];
  readonly points: readonly SketchDrawingPoint[];
  /** Closed regions, pickable as 'sketchRegion' (M13); none = no regions. */
  readonly regions?: readonly SketchDrawingRegion[];
  /**
   * The sketch edited in the sketcher (M19.2): bodies do not hide it from picking, its hidden parts
   * are drawn faint and dashed and the sketch grid lies in its plane. Absent = false; drawings of
   * the regeneration, planes and axes never have it.
   */
  readonly editing?: boolean;
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

/** M19: the HUD of a manipulator moves (spec 10, "Port viewportu"). */
export interface ViewChangedEvent {
  readonly generation: number;
}

export interface KeyMods {
  readonly shift: boolean;
  readonly alt: boolean;
  /** Cmd on Mac, Ctrl elsewhere. */
  readonly mod: boolean;
}

/** State of a handle view: the dragged handle is active, the one under the cursor hover (M18). */
export type HandleState = 'idle' | 'hover' | 'active';

/** Fields every handle view has; dashed since M19 (the pivot mode). */
interface ViewBase {
  readonly id: string;
  readonly tint: HandleTint;
  readonly state: HandleState;
  readonly dashed: boolean;
}

/** What render draws for a handle (M18; planar, point, zero and extent since M19): no functions and no value. */
export type HandleView =
  | (ViewBase & {
      readonly kind: 'linear';
      readonly position: Vec3;
      readonly direction: Vec3;
    })
  | (ViewBase & {
      readonly kind: 'angular';
      readonly center: Vec3;
      readonly axis: Vec3;
      readonly zero: Vec3;
      readonly extent: 'quarter' | 'full';
    })
  | (ViewBase & {
      readonly kind: 'planar';
      readonly origin: Vec3;
      readonly u: Vec3;
      readonly v: Vec3;
    })
  | (ViewBase & { readonly kind: 'point'; readonly position: Vec3 });

/**
 * A mirror like HighlightPort (M18): the controller holds the state and passes it whole. The
 * value label is gone since M19: ui draws the field of the HUD.
 */
export interface ManipulatorPort {
  /** Always the whole state; [] = nothing. */
  set(handles: readonly HandleView[]): void;
  /** Id of the handle under the cursor (by the last set); null = none. */
  pick(x: number, y: number): string | null;
}
