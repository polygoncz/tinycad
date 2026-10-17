import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { Vec2 } from '@/core';
import type { TextContour, TextFontId } from '@/sketch';
import { createOpentypeOutliner } from '@/text-opentype';

// The adapter with the real bundled fonts, read from disk (the app loads them over Vite URLs).

const FILES: Record<TextFontId, string> = {
  sans: 'NotoSans-Regular.ttf',
  serif: 'NotoSerif-Regular.ttf',
  mono: 'NotoSansMono-Regular.ttf',
};

async function loadFont(font: TextFontId): Promise<ArrayBuffer> {
  const url = new URL(`../../../src/text-opentype/fonts/${FILES[font]}`, import.meta.url);
  const bytes = await readFile(url);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const outliner = createOpentypeOutliner(loadFont);
const outline = (text: string, font: TextFontId = 'sans', height = 10) =>
  outliner.outline({ text, font, height });
const advance = (text: string, font: TextFontId = 'sans', height = 10) =>
  outliner.advance({ text, font, height });

const same = (a: Vec2 | undefined, b: Vec2 | undefined) =>
  a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1];

/** All poles of the contours. */
const poles = (contours: readonly TextContour[]): Vec2[] =>
  contours.flatMap((c) => c.segments.flatMap((s) => [...s]));

describe('createOpentypeOutliner – outline', () => {
  it.each([
    ['o', 2],
    ['a', 2],
    ['B', 3],
    ['l', 1],
  ])('"%s" gives %i loops', async (text, loops) => {
    for (const font of ['sans', 'serif', 'mono'] as const) {
      expect((await outline(text, font)).length).toBe(loops);
    }
  });

  it('gives no loops for a space', async () => {
    expect(await outline(' ')).toEqual([]);
    expect(await outline('')).toEqual([]);
  });

  it('gives closed, continuous loops of lines, quadratic and cubic segments', async () => {
    for (const font of ['sans', 'serif', 'mono'] as const) {
      const contours = await outline('oaB Žluťoučký kůň & 0123', font);
      expect(contours.length).toBeGreaterThan(20);
      for (const c of contours) {
        expect(c.segments.length).toBeGreaterThan(0);
        c.segments.forEach((seg, i) => {
          expect(seg.length).toBeGreaterThanOrEqual(2);
          expect(seg.length).toBeLessThanOrEqual(4);
          for (const [x, y] of seg) {
            expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          }
          const next = c.segments[(i + 1) % c.segments.length];
          expect(same(seg[seg.length - 1], next?.[0])).toBe(true);
          // No zero-length segments.
          expect(seg.every((p) => same(p, seg[0]))).toBe(false);
        });
      }
    }
  });

  it('maps loops to code point indexes and code points (diacritics)', async () => {
    const contours = await outline('Žluť');
    const chars = [...new Set(contours.map((c) => c.char))];
    expect(chars).toEqual([0, 1, 2, 3]);
    for (const c of contours) {
      expect(c.code).toBe(Array.from('Žluť')[c.char]?.codePointAt(0));
    }
    // Ž has the caron as its own loop, ť the apostrophe-like caron.
    expect(contours.filter((c) => c.char === 0).length).toBe(2);
    expect(contours.filter((c) => c.char === 3).length).toBe(2);
  });

  it('counts characters as code points, not UTF-16 units', async () => {
    const contours = await outline('a😀b');
    expect(contours.map((c) => [c.char, c.code])).toEqual([
      [0, 0x61],
      [0, 0x61],
      // The emoji is one code point (two UTF-16 units): .notdef, a box with a hole.
      [1, 0x1f600],
      [1, 0x1f600],
      [2, 0x62],
      [2, 0x62],
    ]);
  });

  it('scales coordinates linearly with the height', async () => {
    const small = poles(await outline('aBg', 'serif', 10));
    const big = poles(await outline('aBg', 'serif', 25));
    expect(big.length).toBe(small.length);
    big.forEach(([x, y], i) => {
      expect(x).toBeCloseTo((small[i]?.[0] ?? NaN) * 2.5, 9);
      expect(y).toBeCloseTo((small[i]?.[1] ?? NaN) * 2.5, 9);
    });
  });

  it('has y up: the baseline at 0, capitals above it, descenders below', async () => {
    const h = poles(await outline('H', 'sans', 10));
    expect(Math.min(...h.map(([, y]) => y))).toBeCloseTo(0, 9);
    const capTop = Math.max(...h.map(([, y]) => y));
    expect(capTop).toBeGreaterThan(6);
    expect(capTop).toBeLessThan(8);
    const g = poles(await outline('g', 'sans', 10));
    expect(Math.min(...g.map(([, y]) => y))).toBeLessThan(-1);
  });

  it('places the letters along x by their advances', async () => {
    const contours = await outline('ll', 'mono', 10);
    const xs = (char: number) =>
      contours.filter((c) => c.char === char).flatMap((c) => poles([c]).map(([x]) => x));
    const shift = await advance('l', 'mono', 10);
    expect(Math.min(...xs(1))).toBeCloseTo(Math.min(...xs(0)) + shift, 9);
  });

  it('gives the missing glyph (.notdef) for a character the font lacks, without an error', async () => {
    const contours = await outline('a中b');
    expect([...new Set(contours.map((c) => c.char))]).toEqual([0, 1, 2]);
    // The subset fonts keep the .notdef outline (pyftsubset --notdef-outline): a box with a hole.
    expect(contours.filter((c) => c.char === 1).length).toBeGreaterThan(0);
    expect(await advance('a中b')).toBeGreaterThan(await advance('ab'));
  });
});

describe('createOpentypeOutliner – advance', () => {
  it('is 0 for empty text and grows with the text', async () => {
    expect(await advance('')).toBe(0);
    const one = await advance('a');
    expect(one).toBeGreaterThan(0);
    expect(await advance('ab')).toBeGreaterThan(one);
    expect(await advance(' ')).toBeGreaterThan(0);
  });

  it('scales linearly with the height', async () => {
    expect(await advance('Text', 'serif', 30)).toBeCloseTo(
      (await advance('Text', 'serif', 10)) * 3,
    );
  });

  it('is equal per character in the mono font', async () => {
    const i = await advance('i', 'mono');
    expect(await advance('iii', 'mono')).toBeCloseTo(3 * i, 9);
    expect(await advance('MWM', 'mono')).toBeCloseTo(3 * i, 9);
  });

  it('applies the kerning of the font', async () => {
    const pair = await advance('AV');
    expect(pair).toBeLessThan((await advance('A')) + (await advance('V')));
  });
});

describe('createOpentypeOutliner – font cache', () => {
  it('loads and parses each font once, concurrent calls share it', async () => {
    const load = vi.fn(loadFont);
    const cached = createOpentypeOutliner(load);
    await Promise.all([
      cached.outline({ text: 'a', font: 'sans', height: 10 }),
      cached.advance({ text: 'b', font: 'sans', height: 5 }),
      cached.outline({ text: 'c', font: 'sans', height: 1 }),
    ]);
    await cached.advance({ text: 'd', font: 'sans', height: 10 });
    expect(load).toHaveBeenCalledTimes(1);
    await cached.outline({ text: 'a', font: 'mono', height: 10 });
    expect(load.mock.calls.map(([font]) => font)).toEqual(['sans', 'mono']);
  });

  it('does not load a font before it is used', () => {
    const load = vi.fn(loadFont);
    createOpentypeOutliner(load);
    expect(load).not.toHaveBeenCalled();
  });

  it('retries loading after a failed load', async () => {
    const load = vi
      .fn<(font: TextFontId) => Promise<ArrayBuffer>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(loadFont);
    const retrying = createOpentypeOutliner(load);
    await expect(retrying.advance({ text: 'a', font: 'sans', height: 10 })).rejects.toThrow(
      'offline',
    );
    expect(await retrying.advance({ text: 'a', font: 'sans', height: 10 })).toBeGreaterThan(0);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
