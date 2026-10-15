import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import { AO_SETTING_RANGES, DEFAULT_AO_SETTINGS, isValidAoSetting } from '@/app';
import type { AoSettings } from '@/app';
import type { KeyValueStorage } from '../storage';

// Settings of the ambient occlusion (spec 11, "Nastavení AO", Q081): a page preference next to
// the display style, kept apart so a slider never touches the style. A slider changes a value
// live (set) and stores it once released (commit). The environment is passed in, so the logic
// runs in Node tests; use-ao-settings.ts binds it to the browser, AppShell hands the settings to
// the session.

export interface AoSettingsEnv {
  /** null when storage is unavailable. */
  readonly storage: KeyValueStorage | null;
}

export interface AoSettingsController {
  readonly settings: Readonly<ShallowRef<AoSettings>>;
  /**
   * Changes one value live without storing it (dragging a slider). The value is clamped into
   * its range, an `integer` one rounded; a non-finite value or the current one changes nothing.
   */
  set(key: keyof AoSettings, value: number): void;
  /** Stores the current settings (the slider released). */
  commit(): void;
  /** Sets DEFAULT_AO_SETTINGS and stores them. */
  reset(): void;
}

const AO_SETTINGS_KEY = 'tinycad.aoSettings';

function settingOr(key: keyof AoSettings, value: unknown): number {
  return typeof value === 'number' && isValidAoSetting(key, value)
    ? value
    : DEFAULT_AO_SETTINGS[key];
}

/**
 * Stored settings validated per field: an invalid or missing field falls back to its default
 * without dropping the rest. Invalid JSON or a non-object gives the whole default.
 */
function pickAoSettings(stored: string | null): AoSettings {
  if (stored === null) return DEFAULT_AO_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return DEFAULT_AO_SETTINGS;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return DEFAULT_AO_SETTINGS;
  }
  // A plain object of unknown shape; every field is checked by settingOr before use.
  const fields = parsed as Partial<Record<keyof AoSettings, unknown>>;
  return Object.freeze({
    radiusPx: settingOr('radiusPx', fields.radiusPx),
    intensity: settingOr('intensity', fields.intensity),
    thicknessPx: settingOr('thicknessPx', fields.thicknessPx),
    distanceFallOff: settingOr('distanceFallOff', fields.distanceFallOff),
    scale: settingOr('scale', fields.scale),
    samples: settingOr('samples', fields.samples),
  });
}

/** The value moved into the range of its setting; rounded when the setting is `integer`. */
function clampSetting(key: keyof AoSettings, value: number): number {
  const { min, max, integer } = AO_SETTING_RANGES[key];
  const aligned = integer ? Math.round(value) : value;
  return Math.min(max, Math.max(min, aligned));
}

/** Loading writes nothing; set changes only the memory, commit and reset store. */
export function createAoSettingsController(env: AoSettingsEnv): AoSettingsController {
  const settings = shallowRef(pickAoSettings(env.storage?.getItem(AO_SETTINGS_KEY) ?? null));

  const store = (): void => {
    env.storage?.setItem(AO_SETTINGS_KEY, JSON.stringify(settings.value));
  };

  return {
    settings,
    set: (key, value) => {
      if (!Number.isFinite(value)) return;
      const next = clampSetting(key, value);
      if (next === settings.value[key]) return;
      settings.value = Object.freeze({ ...settings.value, [key]: next });
    },
    commit: store,
    reset: () => {
      settings.value = DEFAULT_AO_SETTINGS;
      store();
    },
  };
}
