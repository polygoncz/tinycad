import { describe, expect, it } from 'vitest';
import { createOrbitModeController } from './orbit-mode';

function aStorage(stored: string | null) {
  const data = new Map<string, string>(stored === null ? [] : [['tinycad.orbitMode', stored]]);
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  return { storage, data };
}

describe('createOrbitModeController', () => {
  it('defaults to turntable and stores nothing at the start', () => {
    const s = aStorage(null);
    const c = createOrbitModeController({ storage: s.storage });
    expect(c.mode.value).toBe('turntable');
    expect(s.data.has('tinycad.orbitMode')).toBe(false);
  });

  it('loads a stored free', () => {
    const c = createOrbitModeController({ storage: aStorage('free').storage });
    expect(c.mode.value).toBe('free');
  });

  it('ignores an invalid stored value', () => {
    const c = createOrbitModeController({ storage: aStorage('upside-down').storage });
    expect(c.mode.value).toBe('turntable');
  });

  it('toggle switches the mode and remembers it', () => {
    const s = aStorage(null);
    const c = createOrbitModeController({ storage: s.storage });
    c.toggle();
    expect(c.mode.value).toBe('free');
    expect(s.data.get('tinycad.orbitMode')).toBe('free');
    c.toggle();
    expect(c.mode.value).toBe('turntable');
    expect(s.data.get('tinycad.orbitMode')).toBe('turntable');
  });

  it('works without storage', () => {
    const c = createOrbitModeController({ storage: null });
    expect(c.mode.value).toBe('turntable');
    c.toggle();
    expect(c.mode.value).toBe('free');
  });
});
