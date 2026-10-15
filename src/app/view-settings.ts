// Settings of the view that belong to the page (spec 11, "Kompoziční kořen (app)"; D7 of M20):
// the theme, the labels of the view cube, the rotation mode, the display style (M22). ui owns them and hands them over
// through one port; app picks the scene palette of a theme (Q072), so ui knows nothing of
// render. A new setting is one method here, forwarded to the viewport.

import { ObservableValue } from '@/core';
import type { Observable, Unsubscribe } from '@/core';
import { DARK_PALETTE, LIGHT_PALETTE } from '@/render';
import type { DisplayStyle, OrbitMode, ScenePalette, Viewport, ViewCubeLabels } from '@/render';

/** The port of ui (ADR 0011: app defines what ui may set); createViewSettings implements it. */
export interface ViewSettings {
  /** Q072: app picks the ScenePalette, ui does not know render. */
  setTheme(theme: 'light' | 'dark'): void;
  /** M17: translated labels of the view cube from ui; render knows no i18n. */
  setViewCubeLabels(labels: ViewCubeLabels): void;
  /** M17.1: the rotation mode from ui (a page preference like the theme). */
  setOrbitMode(mode: OrbitMode): void;
  /** M17.1: request of the rotation mode button of the view cube, forwarded from the viewport. */
  onOrbitModeToggle(listener: () => void): Unsubscribe;
  /** M22: how the bodies are drawn, from ui (a page preference like the rotation mode). */
  setDisplayStyle(style: DisplayStyle): void;
}

/** What createViewSettings needs of the viewport: its settings, as render's Viewport has them. */
export type ViewportSettings = Pick<
  Viewport,
  'setPalette' | 'setViewCubeLabels' | 'setOrbitMode' | 'onOrbitModeToggle' | 'setDisplayStyle'
>;

/**
 * The view settings over the viewport and the default body colour that follows the theme.
 * `theme` is the theme at the start: the viewport was created with its palette, so only the
 * first value of defaultBodyColor comes from it.
 */
export function createViewSettings(
  viewport: ViewportSettings,
  theme: 'light' | 'dark',
): {
  readonly viewSettings: ViewSettings;
  /** M15: '#rrggbb' face colour of the current palette, for the colour field in ui. */
  readonly defaultBodyColor: Observable<string>;
} {
  const defaultBodyColor = new ObservableValue(hexColor(paletteOf(theme).face));
  return {
    viewSettings: {
      setTheme(next) {
        const palette = paletteOf(next);
        viewport.setPalette(palette);
        defaultBodyColor.set(hexColor(palette.face));
      },
      setViewCubeLabels(labels) {
        viewport.setViewCubeLabels(labels);
      },
      setOrbitMode(mode) {
        viewport.setOrbitMode(mode);
      },
      onOrbitModeToggle(listener) {
        return viewport.onOrbitModeToggle(listener);
      },
      setDisplayStyle(style) {
        viewport.setDisplayStyle(style);
      },
    },
    defaultBodyColor: defaultBodyColor.asObservable(),
  };
}

/** The scene palette of a theme (Q072); openAppSession creates the viewport with it too. */
export function paletteOf(theme: 'light' | 'dark'): ScenePalette {
  return theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
}

/** 0xRRGGBB of a palette → '#rrggbb', the form of a body colour in the document. */
function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
