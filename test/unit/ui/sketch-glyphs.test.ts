import { describe, expect, it, vi } from 'vitest';
import type { Vec3 } from '@/core';
import type { SketchGlyphView } from '@/sketcher';
import type { ScreenPoint } from '@/ui/manipulator-hud';
import {
  GLYPH_LAYOUT,
  glyphKey,
  glyphLabel,
  glyphLayout,
  glyphListeners,
} from '@/ui/sketch-glyphs';

// Test ids are trusted.
const cid = (id: string): SketchGlyphView['constraint'] => id as SketchGlyphView['constraint'];
const eid = (id: string): SketchGlyphView['entity'] => id as SketchGlyphView['entity'];

function aGlyph(overrides: Partial<SketchGlyphView> = {}): SketchGlyphView {
  return {
    constraint: cid('c1'),
    kind: 'horizontal',
    entity: eid('l1'),
    anchor: [0, 0, 0],
    side: [0, 1, 0],
    slot: 0,
    hover: false,
    selected: false,
    ...overrides,
  };
}

/** A top view 2 px = 1 mm with the origin at (100, 200); screen y grows down. */
const project = (world: Vec3): ScreenPoint => [100 + 2 * world[0], 200 - 2 * world[1]];

describe('glyphLayout (spec 12, "Glyfy vazeb (M25)")', () => {
  it('has the sizes of the spec by default', () => {
    expect(GLYPH_LAYOUT).toEqual({ sizePx: 16, gapPx: 2, offsetPx: 10 });
  });

  it('puts slot 0 offsetPx + sizePx/2 from the anchor along the projected side', () => {
    const glyph = aGlyph();
    const placed = glyphLayout([glyph], project);
    // side +y of the plane = up on the screen; 10 + 8 = 18 px, independent of the zoom.
    expect(placed).toEqual([{ glyph, at: [100, 182] }]);
  });

  it('stacks the slots by sizePx + gapPx', () => {
    const glyphs = [0, 1, 2].map((slot) =>
      aGlyph({ constraint: cid(`c${String(slot)}`), slot, side: [1, 0, 0] }),
    );
    const at = glyphLayout(glyphs, project).map((p) => p.at);
    expect(at).toEqual([
      [118, 200],
      [136, 200],
      [154, 200],
    ]);
  });

  it('normalises a skew side on the screen', () => {
    const glyph = aGlyph({ anchor: [10, 0, 0], side: [Math.SQRT1_2, Math.SQRT1_2, 0] });
    const [placed] = glyphLayout([glyph], project, { sizePx: 10, gapPx: 0, offsetPx: 0 });
    const d = 5 * Math.SQRT1_2;
    expect(placed?.at[0]).toBeCloseTo(120 + d, 9);
    expect(placed?.at[1]).toBeCloseTo(200 - d, 9);
  });

  it('takes the options', () => {
    const glyph = aGlyph({ slot: 1 });
    const [placed] = glyphLayout([glyph], project, { sizePx: 10, gapPx: 4, offsetPx: 6 });
    // 6 + 1 · 14 + 5 = 25.
    expect(placed?.at).toEqual([100, 175]);
  });

  it('leaves out a glyph whose anchor does not project', () => {
    const hidden = aGlyph({ constraint: cid('hidden'), anchor: [50, 0, 0] });
    const shown = aGlyph();
    const partial = (world: Vec3): ScreenPoint | null => (world[0] === 50 ? null : project(world));
    expect(glyphLayout([hidden, shown], partial).map((p) => p.glyph)).toEqual([shown]);
  });

  it('leaves out a glyph whose side has no direction on the screen', () => {
    const glyph = aGlyph({ side: [0, 0, 1] });
    expect(glyphLayout([glyph], project)).toEqual([]);
  });

  it('keeps the order of the glyphs', () => {
    const a = aGlyph({ constraint: cid('a') });
    const b = aGlyph({ constraint: cid('b'), slot: 1 });
    expect(glyphLayout([b, a], project).map((p) => p.glyph)).toEqual([b, a]);
  });
});

describe('glyphKey', () => {
  it('differs for the two glyphs of one constraint', () => {
    const a = aGlyph({ entity: eid('l1') });
    const b = aGlyph({ entity: eid('l2') });
    expect(glyphKey(a)).not.toBe(glyphKey(b));
    expect(glyphKey(a)).toBe(glyphKey(aGlyph({ entity: eid('l1'), slot: 3 })));
  });
});

describe('glyphLabel', () => {
  it('is the name of the kind of the constraint', () => {
    const t = (key: string): string => `<${key}>`;
    expect(glyphLabel(t, 'parallel')).toBe('<sketch.constraint.parallel>');
  });
});

describe('glyphListeners', () => {
  const noKeys = { shiftKey: false, ctrlKey: false, metaKey: false };
  const aSketch = () => ({ setHover: vi.fn(), select: vi.fn() });

  it('hovers the constraint on pointerenter and clears the hover on pointerleave', () => {
    const sketch = aSketch();
    const on = glyphListeners(sketch, aGlyph());
    on.pointerenter();
    expect(sketch.setHover).toHaveBeenLastCalledWith(cid('c1'));
    on.pointerleave();
    expect(sketch.setHover).toHaveBeenLastCalledWith(null);
    expect(sketch.select).not.toHaveBeenCalled();
  });

  it('selects the constraint on click, additively with Shift, Ctrl or Cmd', () => {
    const sketch = aSketch();
    const on = glyphListeners(sketch, aGlyph());
    on.click(noKeys);
    expect(sketch.select).toHaveBeenLastCalledWith(cid('c1'), { additive: false });
    for (const key of ['shiftKey', 'ctrlKey', 'metaKey'] as const) {
      on.click({ ...noKeys, [key]: true });
      expect(sketch.select).toHaveBeenLastCalledWith(cid('c1'), { additive: true });
    }
  });
});
