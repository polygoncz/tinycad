import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import type { Component } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { AppSession } from '@/app';
import { ObservableValue } from '@/core';
import type { Vec3 } from '@/core';
import type { SketchState } from '@/sketcher';
import SketchInput from '@/ui/components/SketchInput.vue';
import { SESSION_KEY } from '@/ui/composables/use-session';
import { createUiI18n } from '@/ui/i18n/i18n';
import type { ScreenPoint } from '@/ui/manipulator-hud';
import type { InputFieldView, InputSketch } from '@/ui/sketch-input';

// Unit tests run in Node without a DOM, where Vite compiles an SFC for the server: the component
// is rendered to HTML. Its layout is the pure inputLayout (test/unit/ui/sketch-input).

/** A top view 1 px = 1 mm, origin at (100, 200); the point x = 99 does not project. */
const view: AppSession['view'] = {
  project: (world: Vec3): ScreenPoint | null =>
    world[0] === 99 ? null : [100 + world[0], 200 - world[1]],
  onViewChanged: () => () => undefined,
};

function aField(overrides: Partial<InputFieldView> = {}): InputFieldView {
  return {
    id: 'length',
    kind: 'length',
    text: '50.00',
    typed: false,
    locked: false,
    valid: true,
    active: false,
    ...overrides,
  };
}

async function render(numericInput: SketchState['numericInput']): Promise<string> {
  const state = new ObservableValue<Pick<SketchState, 'numericInput'>>({ numericInput });
  const sketch: InputSketch = { state };
  // typescript-eslint sees a .vue import of a test untyped (the fallback src/env.d.ts is not in the
  // test project); vue-tsc checks it against the real type.
  const app = createSSRApp(SketchInput as Component, { sketch });
  app.use(createUiI18n({ cs: {}, en: {} }, { storage: null, language: 'en' }));
  // The component reads only session.view.
  app.provide(SESSION_KEY, { view } as AppSession);
  return renderToString(app);
}

/** The opening tags of the fields (the class "field" among others). */
function fields(html: string): string[] {
  return html.match(/<span class="(?:[^"]* )?field(?: [^"]*)?"[^>]*>/g) ?? [];
}

describe('SketchInput (spec 12, "Číselný vstup (M32)")', () => {
  it('draws the fields as labels left and up from the anchor, announced politely', async () => {
    const html = await render({
      anchor: [10, 20, 0],
      fields: [aField({ active: true }), aField({ id: 'angle', kind: 'angle', text: '30.00' })],
    });

    expect(html).toContain('aria-live="polite"');
    // The anchor (110, 180), 12 px left and up.
    expect(html).toContain('left:98px;top:168px;');
    expect(fields(html)).toHaveLength(2);
    expect(html).toContain('Length');
    expect(html).toContain('50.00');
    expect(html).toContain('Angle');
    expect(html).not.toContain('<input');
  });

  it('highlights the active field, locks a locked one and marks an invalid one', async () => {
    const html = await render({
      anchor: [0, 0, 0],
      fields: [
        aField({ active: true, typed: true, text: '5' }),
        aField({ id: 'angle', kind: 'angle', locked: true, typed: true, text: '30' }),
        aField({ id: 'x', kind: 'x', typed: true, valid: false, text: '-' }),
      ],
    });

    const [active, locked, invalid] = fields(html);
    expect(active).toContain('active');
    expect(active).toContain('typed');
    expect(locked).toContain('locked');
    expect(invalid).toContain('invalid');
    expect(html.match(/ti-lock/g)).toHaveLength(1);
  });

  it('draws no row without an input or when the anchor does not project', async () => {
    expect(fields(await render(null))).toEqual([]);
    expect(fields(await render({ anchor: [99, 0, 0], fields: [aField()] }))).toEqual([]);
  });
});
