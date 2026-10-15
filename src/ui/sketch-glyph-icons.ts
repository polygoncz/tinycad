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
  // A point on a line: a small circle centred on a slanted line.
  pointOnCurve: strokes('M2 13L14 5', 'M6.5 9A1.5 1.5 0 1 0 9.5 9A1.5 1.5 0 1 0 6.5 9'),
  // The letter M: the mark of the middle.
  midpoint: strokes('M3 12V4L8 9L13 4V12'),
  // Dotted horizontal / vertical line between two points.
  hAlign: strokes('M2 8H4', 'M6 8H10', 'M12 8H14'),
  vAlign: strokes('M8 2V4', 'M8 6V10', 'M8 12V14'),
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
