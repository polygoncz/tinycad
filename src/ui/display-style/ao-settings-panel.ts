import { AO_SETTING_RANGES } from '@/app';
import type { AoSettingRange, AoSettings } from '@/app';
import { formatNumber } from '../components/params/field-values';

// The rows of the AO settings panel (spec 11, "Nastavení AO", Q081) as a pure function of the
// settings, kept out of AoSettingsPanel.vue so it runs in Node tests: radius and intensity on
// top, the rest in the Advanced part. The ranges come from AO_SETTING_RANGES, the only place
// where they are.

export interface AoSettingRow {
  readonly key: keyof AoSettings;
  /** i18n key. */
  readonly label: string;
  readonly range: AoSettingRange;
  readonly value: number;
  /** In the collapsible Advanced part. */
  readonly advanced: boolean;
}

/**
 * Whether a field is in the Advanced part; a Record, so every field of AoSettings has a row. The
 * order of the keys is the order of the rows.
 */
const ROW_ADVANCED: Readonly<Record<keyof AoSettings, boolean>> = {
  radiusPx: false,
  intensity: false,
  thicknessPx: true,
  distanceFallOff: true,
  scale: true,
  samples: true,
};

// Object.keys gives string[]; the keys of a Record<keyof AoSettings, …> are exactly keyof AoSettings.
const ROW_KEYS = Object.keys(ROW_ADVANCED) as (keyof AoSettings)[];

export function aoSettingRows(settings: AoSettings): readonly AoSettingRow[] {
  return ROW_KEYS.map((key) => ({
    key,
    label: `aoSettings.${key}`,
    range: AO_SETTING_RANGES[key],
    value: settings[key],
    advanced: ROW_ADVANCED[key],
  }));
}

/**
 * The text of a value beside its slider: an `integer` setting as a whole number, the others
 * rounded to two decimals without trailing zeros (whole px values stay whole: "32").
 */
export function formatAoSetting(key: keyof AoSettings, value: number): string {
  const { integer } = AO_SETTING_RANGES[key];
  return formatNumber(integer ? Math.round(value) : Math.round(value * 100) / 100);
}
