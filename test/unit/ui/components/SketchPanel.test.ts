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
  | 'entities'
  | 'selection'
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
  entities: [],
  selection: [],
};

type Entity = SketchState['entities'][number];
// Test ids are trusted.
const eid = (id: string): Entity['id'] => id as Entity['id'];

/** A text of 12.5 mm in the serif font, on the line l1. */
const TEXT: Entity = {
  kind: 'text',
  id: eid('t1'),
  text: 'tinycad',
  font: 'serif',
  height: 12.5,
  baseline: eid('l1'),
  contours: [],
};
const POINT: Entity = { kind: 'point', id: eid('p1'), x: 0, y: 0 };

async function render(showAll: boolean, over: Partial<PanelState> = {}): Promise<string> {
  const state = new ObservableValue({ ...STATE, ...over });
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

describe('SketchPanel, section Text (spec 12, "Text ve skice (M37)", Úprava)', () => {
  // Test ids are trusted.
  const sel = (id: string): SketchState['selection'][number] =>
    id as SketchState['selection'][number];

  it('shows the string, the font and the height of the only selected text', async () => {
    const html = await render(false, { entities: [POINT, TEXT], selection: [sel('t1')] });
    expect(html).toMatch(/<h3[^>]*>\s*Text\s*<\/h3>/);
    expect(html).toMatch(/<input[^>]*value="tinycad"/);
    expect(html).toMatch(
      /<input[^>]*value="12.5"[^>]*inputmode="decimal"|<input[^>]*inputmode="decimal"[^>]*value="12.5"/,
    );
    expect(html).toContain('mm');
    // The fonts in the order of TEXT_FONTS, with their labels; the font of the text is selected.
    const options = [...html.matchAll(/<option[^>]*value="(\w+)"[^>]*>\s*([^<]*?)\s*<\/option>/g)];
    expect(options.map((m) => [m[1], m[2]])).toEqual([
      ['sans', 'Sans'],
      ['serif', 'Serif'],
      ['mono', 'Mono'],
    ]);
    expect(html).toMatch(/<option[^>]*value="serif"[^>]*selected/);
    // The fields are named by their labels.
    for (const name of ['Text', 'Font', 'Height']) {
      const forId = new RegExp(`<label for="([^"]+)"[^>]*>\\s*${name}\\s*</label>`).exec(html)?.[1];
      expect(forId).toBeDefined();
      expect(html).toContain(`id="${forId ?? ''}"`);
    }
    // Above the constraints.
    expect(html.indexOf('tinycad')).toBeLessThan(html.indexOf('<details'));
  });

  it('has no section without exactly one text selected', async () => {
    for (const selection of [[], [sel('p1')], [sel('t1'), sel('p1')]]) {
      const html = await render(false, { entities: [POINT, TEXT], selection });
      expect(html).not.toContain('<h3');
      expect(html).not.toContain('<select');
    }
  });
});
