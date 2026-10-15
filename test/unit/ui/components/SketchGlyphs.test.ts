import { describe, expect, it, vi } from 'vitest';
import { createSSRApp } from 'vue';
import type { Component } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { AppSession } from '@/app';
import { ObservableValue } from '@/core';
import type { Vec3 } from '@/core';
import type { SketchGlyphView, SketchState } from '@/sketcher';
import SketchGlyphs from '@/ui/components/SketchGlyphs.vue';
import { SESSION_KEY } from '@/ui/composables/use-session';
import { createUiI18n } from '@/ui/i18n/i18n';
import type { ScreenPoint } from '@/ui/manipulator-hud';
import type { GlyphSketch } from '@/ui/sketch-glyphs';

// Unit tests run in Node without a DOM, where Vite compiles an SFC for the server: the component
// is rendered to HTML. Its listeners are the pure glyphListeners (test/unit/ui/sketch-glyphs).

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

/** A top view 1 px = 1 mm, origin at (100, 200); the point x = 99 does not project. */
const view: AppSession['view'] = {
  project: (world: Vec3): ScreenPoint | null =>
    world[0] === 99 ? null : [100 + world[0], 200 - world[1]],
  onViewChanged: () => () => undefined,
};

async function render(
  glyphs: readonly SketchGlyphView[],
  inference: SketchState['inference'] = null,
): Promise<string> {
  const state = new ObservableValue<Pick<SketchState, 'glyphs' | 'inference'>>({
    glyphs,
    inference,
  });
  const sketch: GlyphSketch = { state, setHover: vi.fn(), select: vi.fn() };
  // typescript-eslint sees a .vue import of a test untyped (the fallback src/env.d.ts is not in the
  // test project); vue-tsc checks it against the real type.
  const app = createSSRApp(SketchGlyphs as Component, { sketch });
  app.use(createUiI18n({ cs: {}, en: {} }, { storage: null, language: 'en' }));
  // The component reads only session.view.
  app.provide(SESSION_KEY, { view } as AppSession);
  return renderToString(app);
}

/** The opening tags of the buttons. */
function buttons(html: string): string[] {
  return html.match(/<button[^>]*>/g) ?? [];
}

/** The classes of a tag, sorted. */
function classes(tag: string | undefined): string[] {
  return (/class="([^"]*)"/.exec(tag ?? '')?.[1] ?? '').split(' ').sort();
}

describe('SketchGlyphs (spec 12, "Glyfy vazeb (M25)")', () => {
  it('draws a button per glyph at its layout, named after the constraint', async () => {
    const html = await render([aGlyph(), aGlyph({ constraint: cid('c2'), kind: 'fix', slot: 1 })]);
    const [first, second] = buttons(html);
    expect(buttons(html)).toHaveLength(2);
    expect(first).toContain('aria-label="Horizontal"');
    expect(second).toContain('aria-label="Fix"');
    // 10 + 8 px above the anchor (100, 200); the next slot 18 px further.
    expect(first).toContain('left:100px;top:182px;width:16px;height:16px;');
    expect(second).toContain('left:100px;top:164px;');
  });

  it('leaves out a glyph whose anchor does not project', async () => {
    const html = await render([aGlyph({ anchor: [99, 0, 0] }), aGlyph({ constraint: cid('c2') })]);
    expect(buttons(html)).toHaveLength(1);
  });

  it('marks a selected glyph with aria-pressed and the hovered or selected one by a class', async () => {
    const html = await render([
      aGlyph({ selected: true }),
      aGlyph({ constraint: cid('c2'), hover: true, slot: 1 }),
      aGlyph({ constraint: cid('c3'), slot: 2 }),
    ]);
    const [selected, hovered, plain] = buttons(html);
    expect(classes(selected)).toEqual(['glyph', 'selected']);
    expect(selected).toContain('aria-pressed="true"');
    expect(classes(hovered)).toEqual(['glyph', 'hover']);
    expect(hovered).toContain('aria-pressed="false"');
    expect(classes(plain)).toEqual(['glyph']);
  });

  it('draws coincident as a dot and the other kinds as their icon', async () => {
    const html = await render([
      aGlyph({ kind: 'coincident' }),
      aGlyph({ constraint: cid('c2'), kind: 'equal', slot: 1 }),
    ]);
    expect(classes(buttons(html)[0])).toEqual(['dot', 'glyph']);
    expect(html.match(/<circle/g)).toHaveLength(1);
    expect(html.match(/<path d="M3 6H13"/g)).toHaveLength(1);
    expect(html.match(/<path/g)).toHaveLength(2);
  });

  it('draws nothing without glyphs', async () => {
    expect(buttons(await render([]))).toEqual([]);
  });

  it('draws the inference preview as inactive icons right and down from its anchor', async () => {
    const html = await render([], { anchor: [0, 0, 0], kinds: ['pointOnCurve', 'equal'] });
    const icons = html.match(/<span[^>]*>/g) ?? [];
    expect(buttons(html)).toEqual([]);
    expect(icons).toHaveLength(2);
    expect(classes(icons[0])).toEqual(['glyph', 'preview']);
    expect(icons[0]).toContain('aria-hidden="true"');
    // 18 px right and down from the anchor (100, 200), the next one 18 px further right.
    expect(icons[0]).toContain('left:118px;top:218px;');
    expect(icons[1]).toContain('left:136px;top:218px;');
    expect(html.match(/<path d="M3 6H13"/g)).toHaveLength(1);
  });
});
