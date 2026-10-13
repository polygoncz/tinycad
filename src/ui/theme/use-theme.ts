import { browserStorage } from '../storage';
import { createThemeController } from './theme';
import type { ThemeController } from './theme';

// Browser binding of the theme controller. The theme belongs to the page, not to a session
// (DocumentList has none), so there is one controller for the whole app, created on first use.

let controller: ThemeController | null = null;

export function useTheme(): ThemeController {
  controller ??= createThemeController({
    storage: browserStorage(),
    prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    root: document.documentElement,
  });
  return controller;
}
