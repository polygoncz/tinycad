import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import type { Component } from 'vue';
import { renderToString } from 'vue/server-renderer';
import ToastStack from '@/ui/components/ToastStack.vue';
import { createUiI18n } from '@/ui/i18n/i18n';
import type { ToastItem } from '@/ui/toasts';

// Unit tests run in Node without a DOM, where Vite compiles an SFC for the server: the component
// is rendered to HTML.

async function render(items: readonly ToastItem[]): Promise<string> {
  // typescript-eslint sees a .vue import of a test untyped (the fallback src/env.d.ts is not in the
  // test project); vue-tsc checks it against the real type.
  const app = createSSRApp(ToastStack as Component, { items });
  app.use(createUiI18n({ cs: {}, en: {} }, { storage: null, language: 'en' }));
  return renderToString(app);
}

describe('ToastStack', () => {
  it('draws every item with its text, in their order', async () => {
    const html = await render([
      { id: 'notice-1', tone: 'info', text: 'First' },
      { id: 'notice-2', tone: 'warning', text: 'Second' },
    ]);
    expect(html.indexOf('First')).toBeGreaterThan(-1);
    expect(html.indexOf('Second')).toBeGreaterThan(html.indexOf('First'));
  });

  it('an error is an alert, the other tones a status', async () => {
    const html = await render([
      { id: 'a', tone: 'error', text: 'E' },
      { id: 'b', tone: 'warning', text: 'W' },
      { id: 'c', tone: 'info', text: 'I' },
    ]);
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html.match(/role="status"/g)).toHaveLength(2);
  });

  it('shows the tone by an icon, not only by colour', async () => {
    const html = await render([
      { id: 'a', tone: 'error', text: 'E' },
      { id: 'b', tone: 'warning', text: 'W' },
      { id: 'c', tone: 'info', text: 'I' },
    ]);
    expect(html).toContain('ti-alert-circle');
    expect(html).toContain('ti-alert-triangle');
    expect(html).toContain('ti-info-circle');
  });

  it('every item has a dismiss button with an accessible name', async () => {
    const html = await render([{ id: 'a', tone: 'info', text: 'I' }]);
    expect(html).toMatch(/<button type="button"[^>]*aria-label="Dismiss"/);
    expect(html).toContain('ti-x');
  });

  it('draws nothing without items', async () => {
    const html = await render([]);
    expect(html).not.toContain('toast');
  });
});
