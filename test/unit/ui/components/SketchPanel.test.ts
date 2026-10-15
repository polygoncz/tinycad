import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import type { Component } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { AppSession } from '@/app';
import { ObservableValue } from '@/core';
import type { SketchConstraintRow, SketchSession, SketchState } from '@/sketcher';
import SketchPanel from '@/ui/components/SketchPanel.vue';
import { SESSION_KEY } from '@/ui/composables/use-session';
import { createUiI18n } from '@/ui/i18n/i18n';

// Unit tests run in Node without a DOM, where Vite compiles an SFC for the server: the panel is
// rendered to HTML. The switch and the focus of a new dimension are the pure toggleShowAllConstraints
// and focusNewDimension (test/unit/ui/sketch-panel); clicking them is left to e2e.

// Test ids are trusted.
const cid = (id: string): SketchConstraintRow['id'] => id as SketchConstraintRow['id'];

/** The fields of SketchState the panel reads. */
type PanelState = Pick<
  SketchState,
  | 'name'
  | 'busy'
  | 'fullyDefined'
  | 'statusKey'
  | 'statusParams'
  | 'message'
  | 'planeMissing'
  | 'planeField'
  | 'constraintRows'
  | 'editingDimension'
>;

const STATE: PanelState = {
  name: 'Sketch 1',
  busy: false,
  fullyDefined: false,
  statusKey: 'sketch.status.dof',
  statusParams: { n: 2 },
  message: null,
  planeMissing: false,
  planeField: null,
  constraintRows: [
    { id: cid('c1'), kind: 'horizontal', n: 1, value: null, selected: false },
    { id: cid('c2'), kind: 'distance', n: 1, value: 40, selected: false },
  ],
  editingDimension: null,
};

async function render(showAll: boolean): Promise<string> {
  const state = new ObservableValue(STATE);
  // The panel reads only the fields of PanelState and calls the methods on user input, which a
  // server render has none of.
  const sketch = { state: state.asObservable() } as unknown as SketchSession;
  const sketches = {
    gridSnap: new ObservableValue(true).asObservable(),
    showAllConstraints: new ObservableValue(showAll).asObservable(),
  };
  // typescript-eslint sees a .vue import of a test untyped (the fallback src/env.d.ts is not in the
  // test project); vue-tsc checks it against the real type.
  const app = createSSRApp(SketchPanel as Component, { sketch });
  app.use(createUiI18n({ cs: {}, en: {} }, { storage: null, language: 'en' }));
  // The panel reads only session.sketches.
  app.provide(SESSION_KEY, { sketches } as unknown as AppSession);
  return renderToString(app);
}

/** The opening tag of the button with the text. */
function buttonWith(html: string, text: string): string | undefined {
  return new RegExp(`(<button[^>]*>)(?:(?!</button>).)*${text}`, 's').exec(html)?.[1];
}

describe('SketchPanel (spec 12, "Glyfy vazeb (M25)", Panel)', () => {
  it('lists the constraints in a section that is collapsed by default', async () => {
    const html = await render(false);
    const details = /<details[^>]*>/.exec(html)?.[0];
    expect(details).toBeDefined();
    expect(details).not.toMatch(/\bopen\b/);
    expect(html).toMatch(/<summary[^>]*>\s*Constraints\s*<\/summary>/);
    // The rows are inside the section.
    const section = /<details[^>]*>(.*)<\/details>/s.exec(html)?.[1] ?? '';
    expect(section).toContain('data-constraint="c1"');
    expect(section).toContain('data-constraint="c2"');
  });

  it('shows the switch "Show constraints" above the section with its state in aria-pressed', async () => {
    const off = await render(false);
    const button = buttonWith(off, 'Show constraints');
    expect(button).toContain('aria-pressed="false"');
    expect(button).toContain('title="Shows the glyphs of all constraints of the sketch');
    expect(off.indexOf('Show constraints')).toBeLessThan(off.indexOf('<details'));

    const on = buttonWith(await render(true), 'Show constraints');
    expect(on).toContain('aria-pressed="true"');
    expect(on).toMatch(/class="[^"]*\bon\b/);
  });
});
