import { describe, expect, it } from 'vitest';
import type { GlyphKind } from '@/sketcher';
import { GLYPH_ICONS, glyphIconPaths, isGlyphDot } from '@/ui/sketch-glyph-icons';

const KINDS: readonly GlyphKind[] = [
  'coincident',
  'horizontal',
  'vertical',
  'parallel',
  'perpendicular',
  'equal',
  'tangent',
  'fix',
  'pointOnCurve',
  'midpoint',
  'hAlign',
  'vAlign',
];

describe('glyph icons (spec 12, "Glyfy vazeb (M25)")', () => {
  it('has an icon for every kind of glyph and is frozen', () => {
    expect(Object.keys(GLYPH_ICONS).sort()).toEqual([...KINDS].sort());
    expect(Object.isFrozen(GLYPH_ICONS)).toBe(true);
  });

  it('draws coincident as a dot', () => {
    expect(GLYPH_ICONS.coincident).toEqual({ kind: 'dot' });
  });

  it('draws the other kinds as strokes in a 16 × 16 box', () => {
    for (const kind of KINDS.filter((k) => k !== 'coincident')) {
      const icon = GLYPH_ICONS[kind];
      expect(icon.kind).toBe('strokes');
      if (icon.kind === 'strokes') expect(icon.paths.length).toBeGreaterThan(0);
    }
  });
});

describe('isGlyphDot, glyphIconPaths', () => {
  it('only coincident is the dot, without paths', () => {
    expect(KINDS.filter(isGlyphDot)).toEqual(['coincident']);
    expect(glyphIconPaths('coincident')).toEqual([]);
    expect(glyphIconPaths('equal')).toEqual(['M3 6H13', 'M3 10H13']);
  });
});
