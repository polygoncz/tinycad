import { describe, expect, it, vi } from 'vitest';
import { createSSRApp } from 'vue';
import type { Component } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { AppSession } from '@/app';
import { ObservableValue } from '@/core';
import type { ToolbarGroup, ToolbarItem } from '@/interaction';
import Toolbar from '@/ui/components/Toolbar.vue';
import { SESSION_KEY } from '@/ui/composables/use-session';
import { createUiI18n } from '@/ui/i18n/i18n';

// Unit tests run in Node without a DOM, where Vite compiles an SFC for the server: the component
// is rendered to HTML. The split button of a tool family (M27, spec 12 "Rodiny nástrojů v liště").

function anItem(id: string, change: Partial<ToolbarItem> = {}): ToolbarItem {
  return {
    id,
    label: `probe.${id}`,
    shortcut: null,
    group: 'draw',
    enabled: true,
    modes: ['sketch'],
    icon: id,
    command: { kind: 'tool', id },
    menuOnly: false,
    active: false,
    variants: [],
    ...change,
  };
}

const circle = anItem('circle', { shortcut: 'C' });
const circle3p = anItem('circle3p', { active: true });
const GROUPS: readonly ToolbarGroup[] = [
  {
    id: 'draw',
    items: [anItem('line'), { ...circle3p, variants: [circle, circle3p] }, anItem('rectangle')],
  },
];

async function render(language: 'cs' | 'en'): Promise<string> {
  const groups = new ObservableValue(GROUPS);
  const toolbar: AppSession['toolbar'] = {
    groups: groups.asObservable(),
    run: vi.fn(),
  };
  // typescript-eslint sees a .vue import of a test untyped (the fallback src/env.d.ts is not in the
  // test project); vue-tsc checks it against the real type.
  const app = createSSRApp(Toolbar as Component);
  app.use(
    createUiI18n(
      {
        cs: {
          'probe.line': 'Úsečka',
          'probe.circle3p': 'Kružnice 3 body',
          'probe.circle': 'Kružnice',
        },
        en: { 'probe.line': 'Line', 'probe.circle3p': '3-point circle', 'probe.circle': 'Circle' },
      },
      { storage: null, language },
    ),
  );
  // The component reads only session.toolbar.
  app.provide(SESSION_KEY, { toolbar } as AppSession);
  return renderToString(app);
}

/** The opening tags of the buttons. */
function buttons(html: string): string[] {
  return html.match(/<button[^>]*>/g) ?? [];
}

/** The aria-label of a tag, or null. */
function ariaLabel(tag: string): string | null {
  return /aria-label="([^"]*)"/.exec(tag)?.[1] ?? null;
}

describe('Toolbar (spec 11, "Komponenty"; M27 split button)', () => {
  it('a family is its shown tool and an arrow opening the menu of its variants', async () => {
    const html = await render('en');
    // The group label has no aria-label (its text names it): only the tools and "…".
    expect(buttons(html).flatMap((tag) => ariaLabel(tag) ?? [])).toEqual([
      'Line',
      '3-point circle',
      'More: 3-point circle',
      'probe.rectangle',
      'More tools',
    ]);
    const arrow = buttons(html).find((tag) => ariaLabel(tag) === 'More: 3-point circle');
    expect(arrow).toContain('aria-haspopup="menu"');
  });

  it('the main part of a family is active when a variant is; a plain button has no arrow', async () => {
    const html = await render('en');
    const main = buttons(html).find((tag) => ariaLabel(tag) === '3-point circle');
    expect(main).toMatch(/class="[^"]*\bactive\b/);
    expect(buttons(html).filter((tag) => tag.includes('aria-haspopup="menu"'))).toHaveLength(1);
  });

  it('the arrow is named in Czech', async () => {
    const html = await render('cs');
    expect(html).toContain('aria-label="Další způsoby: Kružnice 3 body"');
  });
});
