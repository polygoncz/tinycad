import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Checks of the design tokens in tokens.css (spec 11, "Styl" and "Přístupnost"; M19.2 D11): the
// text colours keep WCAG AA contrast on a floating panel and the selection colour of ui matches
// the selection in the scene.

type Theme = 'light' | 'dark';
type Rgba = readonly [r: number, g: number, b: number, a: number];

// The test mirrors src/ui/theme/ (ADR 0023), so the stylesheet is read from there.
const css = readFileSync(join(import.meta.dirname, '../../../../src/ui/theme/tokens.css'), 'utf8');

/** Custom properties declared in the first rule whose selector contains `selector`. */
function declarations(selector: string): ReadonlyMap<string, string> {
  const rule = /([^{}]+)\{([^}]*)\}/g;
  for (const [, selectors = '', body = ''] of css.matchAll(rule)) {
    if (!selectors.includes(selector)) continue;
    const vars = [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
      ([, name = '', value = '']) => [name, value.trim()] as const,
    );
    return new Map(vars);
  }
  throw new Error(`no rule for ${selector}`);
}

const LIGHT = declarations(":root[data-theme='light']");
// The dark theme overrides only some tokens, the rest comes from :root.
const DARK = new Map([...LIGHT, ...declarations(":root[data-theme='dark']")]);

function token(theme: Theme, name: string): string {
  const vars = theme === 'light' ? LIGHT : DARK;
  const value = vars.get(name);
  if (value === undefined) throw new Error(`${theme} theme has no ${name}`);
  return value.replace(/var\((--[\w-]+)\)/g, (_, inner: string) => token(theme, inner));
}

function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1] !== undefined) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 1];
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgba?.[1] !== undefined) {
    const [r = 0, g = 0, b = 0, a = 1] = rgba[1].split(',').map((p) => Number(p.trim()));
    return [r, g, b, a];
  }
  throw new Error(`not a colour: ${value}`);
}

function hexOf(color: number): Rgba {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff, 1];
}

/** `top` over the opaque `bottom` (source-over alpha compositing). */
function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + bottom[0] * (1 - a),
    top[1] * a + bottom[1] * (1 - a),
    top[2] * a + bottom[2] * (1 - a),
    1,
  ];
}

/** Relative luminance of WCAG 2.x. */
function luminance([r, g, b]: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

// Background of the scene behind the panels: ScenePalette.background in render/palette.ts
// (ui does not know render, ADR 0008). Must match palette.ts.
const SCENE_BACKGROUND: Readonly<Record<Theme, number>> = { light: 0xf3f4f6, dark: 0x1f2023 };
// ScenePalette.selection of LIGHT_PALETTE and DARK_PALETTE (M19.2 D1). Must match palette.ts.
const SCENE_SELECTION: Readonly<Record<Theme, number>> = { light: 0xea580c, dark: 0xff9f0a };

const THEMES: readonly Theme[] = ['light', 'dark'];

describe('tokens.css', () => {
  describe.each(THEMES)('%s theme', (theme) => {
    const panel = over(parseColor(token(theme, '--panel-bg')), hexOf(SCENE_BACKGROUND[theme]));

    it.each(['--text-secondary', '--text-tertiary', '--danger'])(
      '%s has contrast at least 4.5:1 on a panel over the scene',
      (name) => {
        const text = parseColor(token(theme, name));
        expect(contrast(text, panel)).toBeGreaterThanOrEqual(4.5);
      },
    );

    it('--selection matches the selection in the scene', () => {
      expect(parseColor(token(theme, '--selection'))).toEqual(hexOf(SCENE_SELECTION[theme]));
    });

    it('--selection-soft is a translucent --selection', () => {
      const [r, g, b, a] = parseColor(token(theme, '--selection-soft'));
      expect([r, g, b, 1]).toEqual(hexOf(SCENE_SELECTION[theme]));
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThan(1);
    });

    it.each(['--danger-soft', '--danger-bg'])('%s is a translucent --danger', (name) => {
      const [r, g, b] = parseColor(token(theme, name));
      expect([r, g, b, 1]).toEqual(parseColor(token(theme, '--danger')));
    });
  });

  it('reserves room for the view cube', () => {
    expect(token('light', '--view-cube-reserve')).toBe('148px');
  });
});
