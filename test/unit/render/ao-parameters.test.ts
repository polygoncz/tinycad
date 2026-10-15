import { describe, expect, it } from 'vitest';
import {
  AO_SETTING_RANGES,
  aoParameters,
  DEFAULT_AO_SETTINGS,
  isValidAoSetting,
  type AoSettings,
} from '@/render/ao-parameters';

const KEYS: readonly (keyof AoSettings)[] = [
  'radiusPx',
  'intensity',
  'thicknessPx',
  'distanceFallOff',
  'scale',
  'samples',
];

const SETTINGS: AoSettings = {
  radiusPx: 20,
  intensity: 0.5,
  thicknessPx: 8,
  distanceFallOff: 0.25,
  scale: 2,
  samples: 12,
};

describe('aoParameters', () => {
  it('scales radius and thickness with the size of a pixel', () => {
    const one = aoParameters(SETTINGS, 0.1);
    const two = aoParameters(SETTINGS, 0.2);
    expect(one.radius).toBeCloseTo(20 * 0.1);
    expect(one.thickness).toBeCloseTo(8 * 0.1);
    expect(two.radius).toBeCloseTo(2 * one.radius);
    expect(two.thickness).toBeCloseTo(2 * one.thickness);
  });

  it('takes the other fields from the settings unchanged', () => {
    for (const worldPerPx of [0.01, 7]) {
      const params = aoParameters(SETTINGS, worldPerPx);
      expect(params.distanceFallOff).toBe(0.25);
      expect(params.scale).toBe(2);
      expect(params.samples).toBe(12);
      expect(params.intensity).toBe(0.5);
    }
  });

  it('throws for a size of a pixel that is not finite and positive', () => {
    expect(() => aoParameters(SETTINGS, 0)).toThrow();
    expect(() => aoParameters(SETTINGS, -1)).toThrow();
    expect(() => aoParameters(SETTINGS, Number.NaN)).toThrow();
    expect(() => aoParameters(SETTINGS, Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('DEFAULT_AO_SETTINGS', () => {
  it('is frozen and every field is valid', () => {
    expect(Object.isFrozen(DEFAULT_AO_SETTINGS)).toBe(true);
    expect(Object.keys(DEFAULT_AO_SETTINGS).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      expect(isValidAoSetting(key, DEFAULT_AO_SETTINGS[key])).toBe(true);
      expect(DEFAULT_AO_SETTINGS[key]).toBeGreaterThanOrEqual(AO_SETTING_RANGES[key].min);
      expect(DEFAULT_AO_SETTINGS[key]).toBeLessThanOrEqual(AO_SETTING_RANGES[key].max);
    }
  });
});

describe('AO_SETTING_RANGES', () => {
  it('has a range with min < max and step > 0 for every field', () => {
    expect(Object.keys(AO_SETTING_RANGES).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      const range = AO_SETTING_RANGES[key];
      expect(range.min).toBeLessThan(range.max);
      expect(range.step).toBeGreaterThan(0);
    }
  });

  it('marks only samples as a whole-number field', () => {
    const integers = KEYS.filter((key) => AO_SETTING_RANGES[key].integer);
    expect(integers).toEqual(['samples']);
  });

  it('is frozen, the ranges too', () => {
    expect(Object.isFrozen(AO_SETTING_RANGES)).toBe(true);
    for (const key of KEYS) expect(Object.isFrozen(AO_SETTING_RANGES[key])).toBe(true);
  });
});

describe('isValidAoSetting', () => {
  it('accepts both ends of the range', () => {
    for (const key of KEYS) {
      expect(isValidAoSetting(key, AO_SETTING_RANGES[key].min)).toBe(true);
      expect(isValidAoSetting(key, AO_SETTING_RANGES[key].max)).toBe(true);
    }
  });

  it('rejects values outside the range', () => {
    for (const key of KEYS) {
      expect(isValidAoSetting(key, AO_SETTING_RANGES[key].min - 1)).toBe(false);
      expect(isValidAoSetting(key, AO_SETTING_RANGES[key].max + 1)).toBe(false);
    }
  });

  it('rejects NaN and infinities', () => {
    for (const key of KEYS) {
      expect(isValidAoSetting(key, Number.NaN)).toBe(false);
      expect(isValidAoSetting(key, Number.POSITIVE_INFINITY)).toBe(false);
      expect(isValidAoSetting(key, Number.NEGATIVE_INFINITY)).toBe(false);
    }
  });

  it('rejects a fractional number of samples, accepts fractions elsewhere', () => {
    expect(isValidAoSetting('samples', 12.5)).toBe(false);
    expect(isValidAoSetting('samples', 12)).toBe(true);
    expect(isValidAoSetting('radiusPx', 12.5)).toBe(true);
    expect(isValidAoSetting('intensity', 0.33)).toBe(true);
  });
});
