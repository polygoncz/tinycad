// Glyphs of the constraints of the open sketch over the view (spec 12, "Glyfy vazeb (M25)";
// Q083): pure functions of projected points in px relative to the view area, kept out of
// SketchGlyphs.vue so they run in Node tests. sketcher gives the anchors, the sides and the slots
// in the world (SketchState.glyphs), ui projects them and stacks the glyphs in pixels.

import { vec3 } from '@/core';
import type { Observable } from '@/core';
import type { GlyphKind, SketchGlyphView, SketchSession, SketchState } from '@/sketcher';
import { isAdditive } from './item-actions';
import type { Project, ScreenPoint } from './manipulator-hud';

/** What SketchGlyphs needs of the sketch session: the glyphs, hover and selection. */
export interface GlyphSketch extends Pick<SketchSession, 'setHover' | 'select'> {
  readonly state: Observable<Pick<SketchState, 'glyphs'>>;
}

export interface GlyphLayoutOptions {
  /** The edge of a glyph. */
  readonly sizePx: number;
  /** The gap between two glyphs of one row. */
  readonly gapPx: number;
  /** The distance of the first glyph from the anchor. */
  readonly offsetPx: number;
}

/** The sizes of the glyphs in the view (spec 12). */
export const GLYPH_LAYOUT: GlyphLayoutOptions = Object.freeze({
  sizePx: 16,
  gapPx: 2,
  offsetPx: 10,
});

/** Where one glyph is drawn: its centre in px of the view area. */
export interface GlyphPlacement {
  readonly glyph: SketchGlyphView;
  readonly at: ScreenPoint;
}

/** Below this length (px per mm) the projected side has no direction on the screen. */
const MIN_SIDE_PX = 1e-9;

/**
 * The centre of each glyph: the projection of the anchor plus the side projected onto the screen
 * and normalised, times offsetPx + slot · (sizePx + gapPx) + sizePx / 2, so the distances are in
 * px whatever the zoom. A glyph whose anchor does not project, or whose side has no direction on
 * the screen (the plane seen edge on), is left out; the others keep their order.
 */
export function glyphLayout(
  glyphs: readonly SketchGlyphView[],
  project: Project,
  options: GlyphLayoutOptions = GLYPH_LAYOUT,
): readonly GlyphPlacement[] {
  const placed: GlyphPlacement[] = [];
  for (const glyph of glyphs) {
    const at = place(glyph, project, options);
    if (at !== null) placed.push({ glyph, at });
  }
  return placed;
}

function place(
  glyph: SketchGlyphView,
  project: Project,
  { sizePx, gapPx, offsetPx }: GlyphLayoutOptions,
): ScreenPoint | null {
  const anchor = project(glyph.anchor);
  const tip = project(vec3.add(glyph.anchor, glyph.side));
  if (anchor === null || tip === null) return null;
  const dx = tip[0] - anchor[0];
  const dy = tip[1] - anchor[1];
  const length = Math.hypot(dx, dy);
  if (length < MIN_SIDE_PX) return null;
  const distance = offsetPx + glyph.slot * (sizePx + gapPx) + sizePx / 2;
  return [anchor[0] + (dx / length) * distance, anchor[1] + (dy / length) * distance];
}

/** A key of a glyph unique in SketchState.glyphs: a constraint has at most one glyph per entity. */
export function glyphKey(glyph: Pick<SketchGlyphView, 'constraint' | 'entity'>): string {
  return `${glyph.constraint}/${glyph.entity}`;
}

/** The name of the constraint of a glyph, its aria-label: `t('sketch.constraint.<kind>')`. */
export function glyphLabel(t: (key: string) => string, kind: GlyphKind): string {
  return t(`sketch.constraint.${kind}`);
}

/** The listeners of the button of a glyph (v-on). */
export interface GlyphListeners {
  readonly pointerenter: () => void;
  readonly pointerleave: () => void;
  readonly click: (e: Parameters<typeof isAdditive>[0]) => void;
}

/**
 * The pointer over a glyph hovers its constraint (the session highlights its entities), leaving
 * it clears the hover; a click selects the constraint, additively with Shift, Ctrl or Cmd
 * (isAdditive), like its row in the panel.
 */
export function glyphListeners(
  sketch: Pick<GlyphSketch, 'setHover' | 'select'>,
  glyph: Pick<SketchGlyphView, 'constraint'>,
): GlyphListeners {
  return {
    pointerenter: () => {
      sketch.setHover(glyph.constraint);
    },
    pointerleave: () => {
      sketch.setHover(null);
    },
    click: (e) => {
      sketch.select(glyph.constraint, { additive: isAdditive(e) });
    },
  };
}
