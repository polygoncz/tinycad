import { describe, expect, it } from 'vitest';
import { AO_SETTING_RANGES, DEFAULT_AO_SETTINGS } from '@/app';
import { createAoSettingsController } from '@/ui/display-style/ao-settings';

const KEY = 'tinycad.aoSettings';

function aStorage(stored: string | null) {
  const data = new Map<string, string>(stored === null ? [] : [[KEY, stored]]);
  let writes = 0;
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes += 1;
      data.set(key, value);
    },
  };
  return { storage, data, writes: () => writes };
}

function stored(s: ReturnType<typeof aStorage>): unknown {
  const raw = s.data.get(KEY);
  return raw === undefined ? undefined : JSON.parse(raw);
}

const CUSTOM = {
  radiusPx: 48,
  intensity: 0.5,
  thicknessPx: 8,
  distanceFallOff: 0.25,
  scale: 2,
  samples: 24,
};

describe('createAoSettingsController', () => {
  it('defaults without a stored value and stores nothing at the start', () => {
    const s = aStorage(null);
    const c = createAoSettingsController({ storage: s.storage });
    expect(c.settings.value).toEqual(DEFAULT_AO_SETTINGS);
    expect(s.writes()).toBe(0);
  });

  it('loads valid stored settings and stores nothing', () => {
    const s = aStorage(JSON.stringify(CUSTOM));
    const c = createAoSettingsController({ storage: s.storage });
    expect(c.settings.value).toEqual(CUSTOM);
    expect(Object.isFrozen(c.settings.value)).toBe(true);
    expect(s.writes()).toBe(0);
  });

  it.each(['{not json', '"radius"', '42', 'null', '[1,2]'])(
    'falls back to the defaults for %s',
    (raw) => {
      const c = createAoSettingsController({ storage: aStorage(raw).storage });
      expect(c.settings.value).toEqual(DEFAULT_AO_SETTINGS);
    },
  );

  it('replaces only the invalid fields with their defaults', () => {
    const raw = JSON.stringify({
      ...CUSTOM,
      radiusPx: 1000,
      intensity: '0.5',
      samples: 12.5,
      scale: null,
    });
    const c = createAoSettingsController({ storage: aStorage(raw).storage });
    expect(c.settings.value).toEqual({
      ...CUSTOM,
      radiusPx: DEFAULT_AO_SETTINGS.radiusPx,
      intensity: DEFAULT_AO_SETTINGS.intensity,
      samples: DEFAULT_AO_SETTINGS.samples,
      scale: DEFAULT_AO_SETTINGS.scale,
    });
  });

  it('gives a missing field its default', () => {
    const raw = JSON.stringify({ radiusPx: 20, intensity: 0.75 });
    const c = createAoSettingsController({ storage: aStorage(raw).storage });
    expect(c.settings.value).toEqual({ ...DEFAULT_AO_SETTINGS, radiusPx: 20, intensity: 0.75 });
  });

  it('set changes the value live without storing it', () => {
    const s = aStorage(null);
    const c = createAoSettingsController({ storage: s.storage });
    c.set('radiusPx', 40);
    expect(c.settings.value).toEqual({ ...DEFAULT_AO_SETTINGS, radiusPx: 40 });
    expect(Object.isFrozen(c.settings.value)).toBe(true);
    expect(s.writes()).toBe(0);
  });

  it('set clamps the value into its range', () => {
    const c = createAoSettingsController({ storage: null });
    c.set('radiusPx', 1000);
    expect(c.settings.value.radiusPx).toBe(AO_SETTING_RANGES.radiusPx.max);
    c.set('intensity', -1);
    expect(c.settings.value.intensity).toBe(AO_SETTING_RANGES.intensity.min);
  });

  it('set rounds samples to a whole number', () => {
    const c = createAoSettingsController({ storage: null });
    c.set('samples', 9.6);
    expect(c.settings.value.samples).toBe(10);
    c.set('samples', 100.4);
    expect(c.settings.value.samples).toBe(AO_SETTING_RANGES.samples.max);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'set ignores %s',
    (value) => {
      const c = createAoSettingsController({ storage: null });
      const before = c.settings.value;
      c.set('scale', value);
      expect(c.settings.value).toBe(before);
    },
  );

  it('set with the same value changes nothing', () => {
    const c = createAoSettingsController({ storage: null });
    const before = c.settings.value;
    c.set('radiusPx', DEFAULT_AO_SETTINGS.radiusPx);
    expect(c.settings.value).toBe(before);
  });

  it('set to a value clamped to the current one changes nothing', () => {
    const c = createAoSettingsController({ storage: null });
    c.set('intensity', AO_SETTING_RANGES.intensity.max);
    const before = c.settings.value;
    c.set('intensity', AO_SETTING_RANGES.intensity.max + 5);
    expect(c.settings.value).toBe(before);
  });

  it('commit stores the current settings', () => {
    const s = aStorage(null);
    const c = createAoSettingsController({ storage: s.storage });
    c.set('radiusPx', 40);
    c.set('scale', 1.5);
    c.commit();
    expect(stored(s)).toEqual({ ...DEFAULT_AO_SETTINGS, radiusPx: 40, scale: 1.5 });
    expect(s.writes()).toBe(1);
  });

  it('reset sets the defaults and stores them', () => {
    const s = aStorage(JSON.stringify(CUSTOM));
    const c = createAoSettingsController({ storage: s.storage });
    c.reset();
    expect(c.settings.value).toEqual(DEFAULT_AO_SETTINGS);
    expect(stored(s)).toEqual(DEFAULT_AO_SETTINGS);
    expect(s.writes()).toBe(1);
  });

  it('works without storage', () => {
    const c = createAoSettingsController({ storage: null });
    expect(c.settings.value).toEqual(DEFAULT_AO_SETTINGS);
    c.set('thicknessPx', 4);
    c.commit();
    expect(c.settings.value.thicknessPx).toBe(4);
    c.reset();
    expect(c.settings.value).toEqual(DEFAULT_AO_SETTINGS);
  });
});
