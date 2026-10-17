import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import type { Component } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { AppSession } from '@/app';
import { ObservableValue } from '@/core';
import type { ToolHint } from '@/interaction';
import ToolHintHud from '@/ui/components/ToolHintHud.vue';
import { SESSION_KEY } from '@/ui/composables/use-session';
import { createUiI18n } from '@/ui/i18n/i18n';

// Unit tests run in Node without a DOM, where Vite compiles an SFC for the server: the component
// is rendered to HTML.

async function render(hint: ToolHint | null, language: 'cs' | 'en' = 'en'): Promise<string> {
  const tools: AppSession['tools'] = { hint: new ObservableValue<ToolHint | null>(hint) };
  // typescript-eslint sees a .vue import of a test untyped (the fallback src/env.d.ts is not in the
  // test project); vue-tsc checks it against the real type.
  const app = createSSRApp(ToolHintHud as Component);
  app.use(
    createUiI18n(
      { cs: { 'hint.test.n': 'Zbývá {n}' }, en: { 'hint.test.n': '{n} left' } },
      { storage: null, language },
    ),
  );
  // The component reads only session.tools.
  app.provide(SESSION_KEY, { tools } as AppSession);
  return renderToString(app);
}

describe('ToolHintHud (spec 11, rule 8a)', () => {
  it('shows the translated hint of the active tool', async () => {
    const html = await render({ key: 'hint.mirror.sources' });
    expect(html).toContain('class="tool-hint-hud"');
    expect(html).toContain('Select points and curves to mirror, Enter continues');
  });

  it('translates in Czech', async () => {
    const html = await render({ key: 'hint.mirror.axis' }, 'cs');
    expect(html).toContain('Klikni na osu zrcadlení (úsečka nebo přímka), Esc zpět');
  });

  it('hands the params to the translation', async () => {
    const html = await render({ key: 'hint.test.n', params: { n: 3 } });
    expect(html).toContain('3 left');
  });

  it('draws nothing without a hint', async () => {
    const html = await render(null);
    expect(html).not.toContain('tool-hint-hud');
  });
});
