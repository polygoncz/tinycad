import { parse } from 'opentype.js';
import type { Font, Glyph, PathCommand, RenderOptions } from 'opentype.js';
import type { Vec2 } from '@/core';
import type { TextContour, TextFontId, TextOutliner, TextSegment } from '@/sketch';

/**
 * Layout options: opentype.js defaults (kerning on) without the substitution features (latin
 * ligatures), so the glyphs map 1:1 to the code points of the text, as TextContour.char needs.
 */
const LAYOUT: RenderOptions = { kerning: true, features: {} };

/**
 * TextOutliner over opentype.js. loadFont supplies the bytes of a bundled font (the app over Vite
 * URLs, Node tests from disk); each font is loaded and parsed on its first use and kept, concurrent
 * calls share one load. A failed load is not kept, the next call loads again.
 */
export function createOpentypeOutliner(
  loadFont: (font: TextFontId) => Promise<ArrayBuffer>,
): TextOutliner {
  const fonts = new Map<TextFontId, Promise<Font>>();

  function fontOf(id: TextFontId): Promise<Font> {
    let font = fonts.get(id);
    if (font === undefined) {
      font = loadFont(id).then((bytes) => parse(bytes));
      fonts.set(id, font);
      font.catch(() => fonts.delete(id));
    }
    return font;
  }

  const outliner: TextOutliner = {
    async outline({ text, font, height }) {
      const parsed = await fontOf(font);
      const codes = codePoints(text);
      const contours: TextContour[] = [];
      layout(parsed, codes, height, (glyph, x, char, code) => {
        const commands = glyph.getPath(x, 0, height, LAYOUT, parsed).commands;
        for (const segments of loops(commands)) contours.push({ char, code, segments });
      });
      return contours;
    },
    async advance({ text, font, height }) {
      return layout(await fontOf(font), codePoints(text), height, () => undefined);
    },
  };
  return Object.freeze(outliner);
}

/** The code points of the text, in order (TextContour.char indexes this). */
function codePoints(text: string): number[] {
  // Code points on purpose (spec 12: TextContour.char indexes code points, not graphemes); a
  // string from the string iterator always has a code point at 0.
  return Array.from(text, (ch) => ch.codePointAt(0) ?? 0);
}

/**
 * Lays the text out on the baseline from x = 0 and calls place for each glyph with its x offset
 * (mm), the index of its character and its code point; returns the total advance (mm).
 */
function layout(
  font: Font,
  codes: readonly number[],
  height: number,
  place: (glyph: Glyph, x: number, char: number, code: number) => void,
): number {
  const text = String.fromCodePoint(...codes);
  let char = 0;
  const advance = font.forEachGlyph(text, 0, 0, height, LAYOUT, (glyph, x) => {
    const code = codes[char];
    if (code === undefined) throw new Error('text-opentype: more glyphs than characters');
    place(glyph, x, char, code);
    char++;
  });
  if (char !== codes.length) throw new Error('text-opentype: fewer glyphs than characters');
  return advance;
}

/**
 * Closed loops of a glyph path. opentype.js has y down, so y is flipped (y up, baseline 0).
 * A loop starts at M and ends at Z, the next M or the end of the path; one not ending at its start
 * gets a closing line. Zero-length segments (all poles equal) are dropped, loops without segments
 * too.
 */
function loops(commands: readonly PathCommand[]): TextSegment[][] {
  const result: TextSegment[][] = [];
  let segments: TextSegment[] = [];
  let start: Vec2 = [0, 0];
  let current: Vec2 = [0, 0];

  const add = (...rest: Vec2[]) => {
    const seg: TextSegment = [current, ...rest];
    if (seg.some((p) => !same(p, current))) segments.push(seg);
    current = rest[rest.length - 1] ?? current;
  };
  const close = () => {
    if (segments.length === 0) return;
    if (!same(current, start)) add(start);
    result.push(segments);
    segments = [];
    current = start;
  };

  for (const c of commands) {
    switch (c.type) {
      case 'M':
        close();
        start = flip(c.x, c.y);
        current = start;
        break;
      case 'L':
        add(flip(c.x, c.y));
        break;
      case 'Q':
        add(flip(c.x1, c.y1), flip(c.x, c.y));
        break;
      case 'C':
        add(flip(c.x1, c.y1), flip(c.x2, c.y2), flip(c.x, c.y));
        break;
      case 'Z':
        close();
        break;
    }
  }
  close();
  return result;
}

/** A point of an opentype.js path (y down) in text coordinates (y up); 0 − y avoids −0. */
function flip(x: number, y: number): Vec2 {
  return [x, 0 - y];
}

function same(a: Vec2, b: Vec2): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
