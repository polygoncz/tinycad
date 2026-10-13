import { createI18n } from 'vue-i18n';
import type { ParamIssue } from '@/document';
import { browserStorage } from '../storage';
import type { KeyValueStorage } from '../storage';
import { cs } from './cs';
import { en } from './en';

// The vue-i18n instance of ui (ADR 0014). The domain carries only keys; ui merges its
// built-in texts with the dictionaries of the plugins and translates at display time.

export type UiLocale = 'cs' | 'en';

/** Dictionaries per language: built-in ones and FeaturePlugin.messages share this shape. */
export interface MessageDictionaries {
  readonly cs: Readonly<Record<string, string>>;
  readonly en: Readonly<Record<string, string>>;
}

export interface LocaleEnv {
  /** null when storage is unavailable (private mode, blocked cookies). */
  readonly storage: KeyValueStorage | null;
  /** navigator.language, 'cs-CZ'. */
  readonly language: string;
}

/** Translation function with named params, as `useI18n().t` and `i18n.global.t`. */
export type Translate = (key: string, named: Record<string, unknown>) => string;

const LOCALE_KEY = 'tinycad.locale';

/** Stored choice if valid, else the browser language; English for anything but Czech. */
export function pickLocale(stored: string | null, language: string): UiLocale {
  if (stored === 'cs' || stored === 'en') return stored;
  return language.toLowerCase().startsWith('cs') ? 'cs' : 'en';
}

export function createUiI18n(plugins: MessageDictionaries, env: LocaleEnv = browserLocaleEnv()) {
  return createI18n({
    legacy: false,
    locale: pickLocale(env.storage?.getItem(LOCALE_KEY) ?? null, env.language),
    fallbackLocale: 'en',
    messages: { cs: merge(cs, plugins.cs), en: merge(en, plugins.en) },
  });
}

export type UiI18n = ReturnType<typeof createUiI18n>;

/** Switches the language of the whole UI and remembers the choice. */
export function setUiLocale(
  i18n: UiI18n,
  locale: UiLocale,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  i18n.global.locale.value = locale;
  storage?.setItem(LOCALE_KEY, locale);
}

/**
 * Adds the dictionaries of the plugins of a session (AppSession.messages) to the running
 * instance: the instance lives with the page, the plugin texts arrive with the first session.
 * Adding the same dictionaries again is fine; a key of a built-in text throws, nothing is added.
 */
export function addPluginMessages(i18n: UiI18n, plugins: MessageDictionaries): void {
  const merged = { cs: merge(cs, plugins.cs), en: merge(en, plugins.en) };
  i18n.global.mergeLocaleMessage('cs', merged.cs);
  i18n.global.mergeLocaleMessage('en', merged.en);
}

/** Text of a validation issue: its code is the key, its params fill the placeholders. */
export function issueText(t: Translate, issue: ParamIssue): string {
  return t(issue.code, issue.params ?? {});
}

function merge(
  builtIn: Readonly<Record<string, string>>,
  plugin: Readonly<Record<string, string>>,
): Record<string, string> {
  for (const key of Object.keys(plugin)) {
    if (Object.hasOwn(builtIn, key)) throw new Error(`Duplicate message key '${key}'`);
  }
  return { ...builtIn, ...plugin };
}

function browserLocaleEnv(): LocaleEnv {
  return { storage: browserStorage(), language: navigator.language };
}
