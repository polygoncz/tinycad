import { DISPLAY_MODES } from '@/app';
import type { DisplayMode, DisplayStyle } from '@/app';
import type { DisplayStyleController } from './display-style';

// The items of the display style menu (spec 11, "Styl zobrazení") as a pure function of the
// style, kept out of DisplayStyleMenu.vue so it runs in Node tests: the four modes as radio
// items, then the toggles. Edges and transparency belong to shaded only (spec 09), so outside it
// they are greyed out; their value is kept and still shown.

/** A toggle of the style the menu can switch. */
export type DisplayStyleToggle = 'edges' | 'transparent' | 'mesh';

export type DisplayStyleMenuItem =
  | {
      readonly kind: 'mode';
      readonly mode: DisplayMode;
      /** i18n key. */
      readonly label: string;
      readonly checked: boolean;
      readonly enabled: true;
    }
  | {
      readonly kind: 'toggle';
      readonly toggle: DisplayStyleToggle;
      /** i18n key. */
      readonly label: string;
      readonly checked: boolean;
      readonly enabled: boolean;
    };

const TOGGLES: readonly DisplayStyleToggle[] = ['edges', 'transparent', 'mesh'];

/** Toggles that only mean something in shaded. */
const SHADED_ONLY: ReadonlySet<DisplayStyleToggle> = new Set(['edges', 'transparent']);

const MODE_ICONS: Readonly<Record<DisplayMode, string>> = {
  shaded: 'ti-cube',
  hiddenRemoved: 'ti-box',
  hiddenVisible: 'ti-box-seam',
  wireframe: 'ti-cube-3d-sphere',
};

/** The Tabler icon class of a mode (the menu button shows the current one). */
export function displayModeIcon(mode: DisplayMode): string {
  return MODE_ICONS[mode];
}

/** The i18n key of the name of a mode. */
export function displayModeLabel(mode: DisplayMode): string {
  return `displayStyle.mode.${mode}`;
}

export function displayStyleMenuItems(style: DisplayStyle): readonly DisplayStyleMenuItem[] {
  const modes = DISPLAY_MODES.map((mode): DisplayStyleMenuItem => ({
    kind: 'mode',
    mode,
    label: displayModeLabel(mode),
    checked: mode === style.mode,
    enabled: true,
  }));
  const toggles = TOGGLES.map((toggle): DisplayStyleMenuItem => ({
    kind: 'toggle',
    toggle,
    label: `displayStyle.${toggle}`,
    checked: style[toggle],
    enabled: style.mode === 'shaded' || !SHADED_ONLY.has(toggle),
  }));
  return [...modes, ...toggles];
}

/** What the menu does after a choice: a mode closes it, a toggle keeps it open. */
export type DisplayStyleChoice = 'close' | 'keepOpen' | 'ignored';

/**
 * Carries out a click on a menu item: a greyed-out toggle does nothing ('ignored'), a mode sets
 * the mode ('close'), a toggle switches its value ('keepOpen').
 */
export function chooseDisplayStyleItem(
  controller: Pick<
    DisplayStyleController,
    'setMode' | 'toggleEdges' | 'toggleTransparent' | 'toggleMesh'
  >,
  item: DisplayStyleMenuItem,
): DisplayStyleChoice {
  if (!item.enabled) return 'ignored';
  if (item.kind === 'mode') {
    controller.setMode(item.mode);
    return 'close';
  }
  switch (item.toggle) {
    case 'edges':
      controller.toggleEdges();
      break;
    case 'transparent':
      controller.toggleTransparent();
      break;
    case 'mesh':
      controller.toggleMesh();
      break;
  }
  return 'keepOpen';
}
