import { describe, expect, it } from 'vitest';
import { createThemeController, pickTheme } from '@/ui/theme/theme';
import type { ThemeEnv } from '@/ui/theme/theme';

function anEnv(stored: string | null, prefersDark: boolean) {
  const data = new Map<string, string>(stored === null ? [] : [['tinycad.theme', stored]]);
  const attributes = new Map<string, string>();
  const env: ThemeEnv = {
    storage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
    },
    prefersDark,
    root: {
      setAttribute: (name, value) => {
        attributes.set(name, value);
      },
    },
  };
  return { env, data, attributes };
}

describe('pickTheme', () => {
  it('prefers a valid stored choice', () => {
    expect(pickTheme('dark', false)).toBe('dark');
    expect(pickTheme('light', true)).toBe('light');
  });

  it('falls back to prefers-color-scheme', () => {
    expect(pickTheme(null, true)).toBe('dark');
    expect(pickTheme(null, false)).toBe('light');
    expect(pickTheme('blue', true)).toBe('dark');
  });
});

describe('createThemeController', () => {
  it('applies the initial theme to the root', () => {
    const s = anEnv(null, true);
    const c = createThemeController(s.env);
    expect(c.theme.value).toBe('dark');
    expect(s.attributes.get('data-theme')).toBe('dark');
    expect(s.data.has('tinycad.theme')).toBe(false);
  });

  it('setTheme applies and remembers the choice', () => {
    const s = anEnv(null, false);
    const c = createThemeController(s.env);
    c.setTheme('dark');
    expect(c.theme.value).toBe('dark');
    expect(s.attributes.get('data-theme')).toBe('dark');
    expect(s.data.get('tinycad.theme')).toBe('dark');
  });

  it('toggle switches between light and dark', () => {
    const s = anEnv('dark', false);
    const c = createThemeController(s.env);
    c.toggle();
    expect(c.theme.value).toBe('light');
    c.toggle();
    expect(c.theme.value).toBe('dark');
  });

  it('works without storage', () => {
    const s = anEnv(null, false);
    const c = createThemeController({ ...s.env, storage: null });
    c.setTheme('dark');
    expect(s.attributes.get('data-theme')).toBe('dark');
  });
});
