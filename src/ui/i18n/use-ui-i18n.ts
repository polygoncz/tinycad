import { inject } from 'vue';
import type { InjectionKey } from 'vue';
import type { UiI18n } from './i18n';

// The vue-i18n instance itself, for what useI18n() does not cover: switching the language
// (setUiLocale) and adding the plugin texts of a session (addPluginMessages). Provided once by
// startUi; components translate through useI18n() as usual.

export const UI_I18N_KEY: InjectionKey<UiI18n> = Symbol('UiI18n');

export function useUiI18n(): UiI18n {
  const i18n = inject(UI_I18N_KEY);
  if (i18n === undefined) throw new Error('No UiI18n provided (start the UI with startUi)');
  return i18n;
}
