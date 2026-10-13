import { createApp } from 'vue';
import type { OpenAppSessionOptions } from '@/app';
import '@tabler/icons-webfont/dist/tabler-icons.min.css';
import './theme/tokens.css';
import App from './App.vue';
import { createUiI18n } from './i18n/i18n';
import { UI_I18N_KEY } from './i18n/use-ui-i18n';

// Starts the Vue application (spec 01: main.ts creates the session and attaches Vue). The
// i18n instance belongs to the page: it starts with the built-in texts only, the plugin texts
// are added with the first session (AppSession.messages).

export interface StartUiOptions {
  /** Feature plugins handed to every openAppSession (app's BUILT_IN_PLUGINS). */
  readonly plugins: OpenAppSessionOptions['plugins'];
}

export function startUi(selector: string, opts: StartUiOptions): void {
  const i18n = createUiI18n({ cs: {}, en: {} });
  createApp(App, { plugins: opts.plugins }).use(i18n).provide(UI_I18N_KEY, i18n).mount(selector);
}
