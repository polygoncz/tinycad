import { describe, expect, it } from 'vitest';
import { AO_SETTING_RANGES, DEFAULT_AO_SETTINGS } from '@/app';
import { aoSettingRows, formatAoSetting } from '@/ui/display-style/ao-settings-panel';
import { cs } from '@/ui/i18n/cs';
import { en } from '@/ui/i18n/en';

describe('aoSettingRows', () => {
  it('lists radius and intensity first, the rest as advanced', () => {
    const rows = aoSettingRows(DEFAULT_AO_SETTINGS);
    expect(rows.map((row) => [row.key, row.advanced])).toEqual([
      ['radiusPx', false],
      ['intensity', false],
      ['thicknessPx', true],
      ['distanceFallOff', true],
      ['scale', true],
      ['samples', true],
    ]);
  });

  it('has exactly one row per field of AO_SETTING_RANGES', () => {
    const keys = aoSettingRows(DEFAULT_AO_SETTINGS).map((row) => row.key);
    expect([...keys].sort()).toEqual(Object.keys(AO_SETTING_RANGES).sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('takes the ranges from AO_SETTING_RANGES and the values from the settings', () => {
    const settings = { ...DEFAULT_AO_SETTINGS, radiusPx: 50, scale: 2.5 };
    for (const row of aoSettingRows(settings)) {
      expect(row.range).toBe(AO_SETTING_RANGES[row.key]);
      expect(row.value).toBe(settings[row.key]);
      expect(row.label).toBe(`aoSettings.${row.key}`);
    }
  });
});

describe('formatAoSetting', () => {
  it('shows integer settings as whole numbers', () => {
    expect(formatAoSetting('samples', 8)).toBe('8');
    expect(formatAoSetting('samples', 8.4)).toBe('8');
  });

  it('rounds the others to two decimals', () => {
    expect(formatAoSetting('radiusPx', 32)).toBe('32');
    expect(formatAoSetting('thicknessPx', 16.4)).toBe('16.4');
    expect(formatAoSetting('intensity', 0.35)).toBe('0.35');
    expect(formatAoSetting('distanceFallOff', 1)).toBe('1');
    expect(formatAoSetting('scale', 1.23456)).toBe('1.23');
    expect(formatAoSetting('scale', 0.1 + 0.2)).toBe('0.3');
  });
});

describe('AO settings texts', () => {
  const keys = [
    'aoSettings.title',
    'aoSettings.close',
    'aoSettings.radiusPx',
    'aoSettings.intensity',
    'aoSettings.advanced',
    'aoSettings.thicknessPx',
    'aoSettings.distanceFallOff',
    'aoSettings.scale',
    'aoSettings.samples',
    'aoSettings.reset',
  ];

  it('has every key in both languages', () => {
    expect(keys.map((key) => cs[key])).toEqual([
      'Ambientní okluze',
      'Zavřít',
      'Poloměr (px)',
      'Síla',
      'Pokročilé',
      'Tloušťka (px)',
      'Útlum se vzdáleností',
      'Měřítko',
      'Vzorky',
      'Výchozí',
    ]);
    expect(keys.map((key) => en[key])).toEqual([
      'Ambient occlusion',
      'Close',
      'Radius (px)',
      'Intensity',
      'Advanced',
      'Thickness (px)',
      'Distance falloff',
      'Scale',
      'Samples',
      'Defaults',
    ]);
  });

  it('labels every row', () => {
    for (const row of aoSettingRows(DEFAULT_AO_SETTINGS)) {
      expect(cs[row.label], row.label).toBeTypeOf('string');
      expect(en[row.label], row.label).toBeTypeOf('string');
    }
  });
});
