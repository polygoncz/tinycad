import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import type { KeyValueStorage } from '../storage';

// Light/dark mode (spec 11, "Styl"): all colours are CSS variables in tokens.css, the mode is
// the data-theme attribute on <html>. Default from prefers-color-scheme, the user's choice is
// remembered. The environment is passed in, so the logic runs in Node tests without DOM;
// use-theme.ts binds it to the browser. The viewport palette follows via
// AppSession.viewSettings.setTheme (Q072), wired where a session exists.

export type Theme = 'light' | 'dark';

export interface ThemeEnv {
  /** null when storage is unavailable. */
  readonly storage: KeyValueStorage | null;
  /** matchMedia('(prefers-color-scheme: dark)').matches */
  readonly prefersDark: boolean;
  /** document.documentElement */
  readonly root: { setAttribute(name: string, value: string): void };
}

export interface ThemeController {
  readonly theme: Readonly<ShallowRef<Theme>>;
  setTheme(theme: Theme): void;
  toggle(): void;
}

const THEME_KEY = 'tinycad.theme';
const THEME_ATTRIBUTE = 'data-theme';

/** Stored choice if valid, else the system preference. */
export function pickTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDark ? 'dark' : 'light';
}

/** Applies the initial theme right away; only an explicit setTheme is remembered. */
export function createThemeController(env: ThemeEnv): ThemeController {
  const theme = shallowRef(pickTheme(env.storage?.getItem(THEME_KEY) ?? null, env.prefersDark));
  env.root.setAttribute(THEME_ATTRIBUTE, theme.value);

  function setTheme(next: Theme): void {
    theme.value = next;
    env.root.setAttribute(THEME_ATTRIBUTE, next);
    env.storage?.setItem(THEME_KEY, next);
  }

  return {
    theme,
    setTheme,
    toggle: () => {
      setTheme(theme.value === 'dark' ? 'light' : 'dark');
    },
  };
}
