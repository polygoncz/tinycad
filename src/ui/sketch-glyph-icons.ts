// The icons of the glyphs of sketch constraints (spec 12, "Glyfy vazeb (M25)"), shaped after
// Fusion and Onshape. Stroked paths in a 16 × 16 view box, drawn in the current colour; coincident
// is a filled dot, smaller than an icon. A Record over GlyphKind: a new kind of constraint fails
// the typecheck here until it has an icon.

import type { GlyphKind } from '@/sketcher';

/** The view box of a stroked icon. */
export const GLYPH_ICON_VIEW_BOX = '0 0 16 16';

export type GlyphIcon =
  | { readonly kind: 'dot' }
  /** SVG path data, each drawn as a stroke without fill. */
  | { readonly kind: 'strokes'; readonly paths: readonly string[] };

const strokes = (...paths: readonly string[]): GlyphIcon => ({ kind: 'strokes', paths });

export const GLYPH_ICONS: Readonly<Record<GlyphKind, GlyphIcon>> = Object.freeze({
  coincident: { kind: 'dot' },
  // The letters H and V.
  horizontal: strokes('M4 3V13', 'M12 3V13', 'M4 8H12'),
  vertical: strokes('M4 3L8 13L12 3'),
  // Two slanted parallel lines.
  parallel: strokes('M3 13L8 3', 'M8 13L13 3'),
  // ⊥: a right angle.
  perpendicular: strokes('M3 13H13', 'M8 13V3'),
  // =
  equal: strokes('M3 6H13', 'M3 10H13'),
  // A circle touching a line below it.
  tangent: strokes('M4 7A4 4 0 1 0 12 7A4 4 0 1 0 4 7', 'M2 11H14'),
  // A padlock: the shackle over the body.
  fix: strokes('M4 8H12V14H4Z', 'M6 8V5.5A2 2 0 0 1 10 5.5V8'),
});

/** Whether the glyph of the kind is the dot (coincident). */
export function isGlyphDot(kind: GlyphKind): boolean {
  return GLYPH_ICONS[kind].kind === 'dot';
}

/** The stroked paths of the icon of the kind; none for the dot. */
export function glyphIconPaths(kind: GlyphKind): readonly string[] {
  const icon = GLYPH_ICONS[kind];
  return icon.kind === 'strokes' ? icon.paths : [];
}
