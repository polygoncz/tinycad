import { DISPLAY_MODES, displayDrawsAo } from '@/app';
import type { DisplayMode, DisplayStyle } from '@/app';
import type { DisplayStyleController } from './display-style';

// The items of the display style menu (spec 11, "Styl zobrazení") as a pure function of the
// style, kept out of DisplayStyleMenu.vue so it runs in Node tests: the five modes as radio
// items, then the toggles. Edges and transparency belong to shaded only (spec 09), so outside it
// they are greyed out, Realistic included; their value is kept and still shown. Whether AO
// draws comes from render's decision table (displayDrawsAo, spec 09), not a copy here: the AO
// toggle is enabled where AO would draw if it were on. Under
// the AO toggle the "AO settings…" command (M23) opens the panel of the AO settings; it is enabled
// only where AO really draws.

/** A toggle of the style the menu can switch. */
export type DisplayStyleToggle = 'edges' | 'transparent' | 'ao' | 'mesh';

/**
 * An item of the menu. `key` is unique in the menu (the mode, the toggle or the command), the
 * v-for key of the component.
 */
export type DisplayStyleMenuItem =
  | {
      readonly kind: 'mode';
      readonly key: DisplayMode;
      readonly mode: DisplayMode;
      /** i18n key. */
      readonly label: string;
      readonly checked: boolean;
      readonly enabled: true;
    }
  | {
      readonly kind: 'toggle';
      readonly key: DisplayStyleToggle;
      readonly toggle: DisplayStyleToggle;
      /** i18n key. */
      readonly label: string;
      readonly checked: boolean;
      readonly enabled: boolean;
    }
  | {
      /** A plain menuitem without a check that opens something. */
      readonly kind: 'command';
      readonly key: 'aoSettings';
      readonly command: 'aoSettings';
      /** i18n key. */
      readonly label: string;
      readonly enabled: boolean;
    };

const TOGGLES: readonly DisplayStyleToggle[] = ['edges', 'transparent', 'ao', 'mesh'];

/** Whether a toggle means something in the style; the others are greyed out. */
function isToggleEnabled(toggle: DisplayStyleToggle, style: DisplayStyle): boolean {
  switch (toggle) {
    case 'edges':
    case 'transparent':
      return style.mode === 'shaded';
    case 'ao':
      return displayDrawsAo({ ...style, ao: true });
    case 'mesh':
      return true;
  }
}

/** Whether AO really draws in the style (spec 09, decision table). */
export function isAoDrawn(style: DisplayStyle): boolean {
  return displayDrawsAo(style);
}

const MODE_ICONS: Readonly<Record<DisplayMode, string>> = {
  shaded: 'ti-cube',
  realistic: 'ti-sparkles',
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
    key: mode,
    mode,
    label: displayModeLabel(mode),
    checked: mode === style.mode,
    enabled: true,
  }));
  const toggles = TOGGLES.map((toggle): DisplayStyleMenuItem => ({
    kind: 'toggle',
    key: toggle,
    toggle,
    label: `displayStyle.${toggle}`,
    checked: style[toggle],
    enabled: isToggleEnabled(toggle, style),
  }));
  const aoSettings: DisplayStyleMenuItem = {
    kind: 'command',
    key: 'aoSettings',
    command: 'aoSettings',
    label: 'displayStyle.aoSettings',
    enabled: isAoDrawn(style),
  };
  // The AO settings stand right under the AO toggle.
  const afterAo = TOGGLES.indexOf('ao') + 1;
  return [...modes, ...toggles.slice(0, afterAo), aoSettings, ...toggles.slice(afterAo)];
}

/**
 * What the menu does after a choice: a mode closes it, a toggle keeps it open, the AO settings
 * close it and open their panel.
 */
export type DisplayStyleChoice = 'close' | 'keepOpen' | 'openAoSettings' | 'ignored';

/**
 * Carries out a click on a menu item: a greyed-out item does nothing ('ignored'), a mode sets
 * the mode ('close'), a toggle switches its value ('keepOpen'), the AO settings call nothing
 * ('openAoSettings', the menu opens the panel).
 */
export function chooseDisplayStyleItem(
  controller: Pick<
    DisplayStyleController,
    'setMode' | 'toggleEdges' | 'toggleTransparent' | 'toggleMesh' | 'toggleAo'
  >,
  item: DisplayStyleMenuItem,
): DisplayStyleChoice {
  if (!item.enabled) return 'ignored';
  if (item.kind === 'mode') {
    controller.setMode(item.mode);
    return 'close';
  }
  if (item.kind === 'command') return 'openAoSettings';
  switch (item.toggle) {
    case 'edges':
      controller.toggleEdges();
      break;
    case 'transparent':
      controller.toggleTransparent();
      break;
    case 'ao':
      controller.toggleAo();
      break;
    case 'mesh':
      controller.toggleMesh();
      break;
  }
  return 'keepOpen';
}
