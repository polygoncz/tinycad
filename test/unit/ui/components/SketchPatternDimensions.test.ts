import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import type { Component } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { AppSession } from '@/app';
import { ObservableValue } from '@/core';
import type { Vec3 } from '@/core';
import type { SketchPatternDimensionView, SketchSession, SketchState } from '@/sketcher';
import SketchPatternDimensions from '@/ui/components/SketchPatternDimensions.vue';
import { SESSION_KEY } from '@/ui/composables/use-session';
import { createUiI18n } from '@/ui/i18n/i18n';
import type { ScreenPoint } from '@/ui/manipulator-hud';

// Unit tests run in Node without a DOM, where Vite compiles an SFC for the server: the component
// is rendered to HTML. Editing a label is the pure commitPatternEdit
// (test/unit/ui/sketch-pattern-dimensions).

// Test ids are trusted.
const eid = (id: string): SketchPatternDimensionView['pattern'] =>
  id as SketchPatternDimensionView['pattern'];

function aPatternDimension(
  overrides: Partial<SketchPatternDimensionView> = {},
): SketchPatternDimensionView {
  return {
    pattern: eid('p1'),
    param: 'count1',
    format: 'count',
    value: 3,
    label: [10, 5, 0],
    guide: [],
    ...overrides,
  };
}

/** A top view 1 px = 1 mm, origin at (100, 200); the point x = 99 does not project. */
const view: AppSession['view'] = {
  project: (world: Vec3): ScreenPoint | null =>
    world[0] === 99 ? null : [100 + world[0], 200 - world[1]],
  onViewChanged: () => () => undefined,
};

async function render(patternDimensions: readonly SketchPatternDimensionView[]): Promise<string> {
  const state = new ObservableValue<Pick<SketchState, 'patternDimensions'>>({ patternDimensions });
  // The component reads only state and calls setPatternParam.
  const sketch = { state, setPatternParam: () => true } as unknown as SketchSession;
  // typescript-eslint sees a .vue import of a test untyped (the fallback src/env.d.ts is not in the
  // test project); vue-tsc checks it against the real type.
  const app = createSSRApp(SketchPatternDimensions as Component, { sketch });
  app.use(createUiI18n({ cs: {}, en: {} }, { storage: null, language: 'en' }));
  // The component reads only session.view.
  app.provide(SESSION_KEY, { view } as AppSession);
  return renderToString(app);
}

/** The opening tags of the buttons. */
function buttons(html: string): string[] {
  return html.match(/<button[^>]*>[^<]*/g) ?? [];
}

describe('SketchPatternDimensions (spec 12, "Vynesené kóty pole")', () => {
  it('draws a label per projected dimension with its text, named after the parameter', async () => {
    const html = await render([
      aPatternDimension(),
      aPatternDimension({ param: 'spacing1', format: 'length', value: 20, label: [0, 0, 0] }),
      aPatternDimension({
        param: 'angle1',
        format: 'angle',
        value: Math.PI / 2,
        label: [99, 0, 0],
      }),
    ]);
    const [count, spacing] = buttons(html);
    expect(buttons(html)).toHaveLength(2);
    expect(count).toContain('aria-label="Count 3×"');
    expect(count).toContain('left:110px;top:195px;');
    expect(count).toContain('3×');
    expect(spacing).toContain('aria-label="Spacing 20 mm"');
    expect(spacing).toContain('left:100px;top:200px;');
  });

  it('draws the guide as lines cut around the label', async () => {
    const html = await render([
      aPatternDimension({
        param: 'spacing1',
        format: 'length',
        value: 100,
        label: [50, 0, 0],
        guide: [
          [0, 0, 0],
          [100, 0, 0],
        ],
      }),
    ]);
    const lines = html.match(/<line[^>]*>/g) ?? [];
    // The guide (100,200)–(200,200) minus the box of "100 mm" around (150, 200): 6 characters, ±25 px.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('x1="100"');
    expect(lines[0]).toContain('x2="125"');
    expect(lines[1]).toContain('x1="175"');
  });

  it('draws nothing without pattern dimensions', async () => {
    const html = await render([]);
    expect(buttons(html)).toHaveLength(0);
    expect(html).not.toContain('<line');
  });
});
