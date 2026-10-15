import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY_STYLE } from '@/app';
import { createDisplayStyleController } from '@/ui/display-style/display-style';

const KEY = 'tinycad.displayStyle';

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

describe('createDisplayStyleController', () => {
  it('defaults without a stored value and stores nothing at the start', () => {
    const s = aStorage(null);
    const c = createDisplayStyleController({ storage: s.storage });
    expect(c.style.value).toEqual(DEFAULT_DISPLAY_STYLE);
    expect(s.writes()).toBe(0);
  });

  it('loads a valid stored style and stores nothing', () => {
    const value = { mode: 'wireframe', edges: false, transparent: true, mesh: true, ao: false };
    const s = aStorage(JSON.stringify(value));
    const c = createDisplayStyleController({ storage: s.storage });
    expect(c.style.value).toEqual(value);
    expect(Object.isFrozen(c.style.value)).toBe(true);
    expect(s.writes()).toBe(0);
  });

  it('loads a stored realistic mode (M24)', () => {
    const value = { mode: 'realistic', edges: true, transparent: false, mesh: false, ao: true };
    const s = aStorage(JSON.stringify(value));
    const c = createDisplayStyleController({ storage: s.storage });
    expect(c.style.value).toEqual(value);
    expect(s.writes()).toBe(0);
  });

  it.each(['{not json', '"shaded"', '42', 'null', '[1,2]'])(
    'falls back to the default for %s',
    (raw) => {
      const c = createDisplayStyleController({ storage: aStorage(raw).storage });
      expect(c.style.value).toEqual(DEFAULT_DISPLAY_STYLE);
    },
  );

  it('replaces only the invalid field with its default', () => {
    const raw = JSON.stringify({
      mode: 'upside-down',
      edges: false,
      transparent: 'yes',
      mesh: true,
    });
    const c = createDisplayStyleController({ storage: aStorage(raw).storage });
    expect(c.style.value).toEqual({
      mode: DEFAULT_DISPLAY_STYLE.mode,
      edges: false,
      transparent: DEFAULT_DISPLAY_STYLE.transparent,
      mesh: true,
      ao: DEFAULT_DISPLAY_STYLE.ao,
    });
  });

  it('gives a missing field its default', () => {
    const raw = JSON.stringify({ mode: 'hiddenVisible', edges: false });
    const c = createDisplayStyleController({ storage: aStorage(raw).storage });
    expect(c.style.value).toEqual({
      mode: 'hiddenVisible',
      edges: false,
      transparent: DEFAULT_DISPLAY_STYLE.transparent,
      mesh: DEFAULT_DISPLAY_STYLE.mesh,
      ao: DEFAULT_DISPLAY_STYLE.ao,
    });
  });

  it('reads an M22 record without ao as ao false and stores nothing', () => {
    const value = { mode: 'shaded', edges: true, transparent: false, mesh: true };
    const s = aStorage(JSON.stringify(value));
    const c = createDisplayStyleController({ storage: s.storage });
    expect(c.style.value).toEqual({ ...value, ao: false });
    expect(s.writes()).toBe(0);
  });

  it.each(['"yes"', '1', 'null'])('replaces an invalid ao %s with the default', (ao) => {
    const raw = `{"mode":"hiddenRemoved","edges":false,"transparent":true,"mesh":true,"ao":${ao}}`;
    const c = createDisplayStyleController({ storage: aStorage(raw).storage });
    expect(c.style.value).toEqual({
      mode: 'hiddenRemoved',
      edges: false,
      transparent: true,
      mesh: true,
      ao: DEFAULT_DISPLAY_STYLE.ao,
    });
  });

  it('setMode changes the style and remembers it', () => {
    const s = aStorage(null);
    const c = createDisplayStyleController({ storage: s.storage });
    c.setMode('hiddenRemoved');
    expect(c.style.value).toEqual({ ...DEFAULT_DISPLAY_STYLE, mode: 'hiddenRemoved' });
    expect(Object.isFrozen(c.style.value)).toBe(true);
    expect(stored(s)).toEqual({ ...DEFAULT_DISPLAY_STYLE, mode: 'hiddenRemoved' });
  });

  it('setMode with the same mode changes and stores nothing', () => {
    const s = aStorage(null);
    const c = createDisplayStyleController({ storage: s.storage });
    const before = c.style.value;
    c.setMode(DEFAULT_DISPLAY_STYLE.mode);
    expect(c.style.value).toBe(before);
    expect(s.writes()).toBe(0);
  });

  it('toggles flip their field and remember it, also outside shaded', () => {
    const s = aStorage(null);
    const c = createDisplayStyleController({ storage: s.storage });
    c.setMode('wireframe');
    const before = c.style.value;
    c.toggleEdges();
    expect(c.style.value.edges).toBe(!DEFAULT_DISPLAY_STYLE.edges);
    expect(before.edges).toBe(DEFAULT_DISPLAY_STYLE.edges);
    c.toggleTransparent();
    expect(c.style.value.transparent).toBe(!DEFAULT_DISPLAY_STYLE.transparent);
    c.toggleMesh();
    expect(c.style.value.mesh).toBe(!DEFAULT_DISPLAY_STYLE.mesh);
    c.toggleAo();
    expect(c.style.value.ao).toBe(!DEFAULT_DISPLAY_STYLE.ao);
    expect(Object.isFrozen(c.style.value)).toBe(true);
    expect(stored(s)).toEqual({
      mode: 'wireframe',
      edges: !DEFAULT_DISPLAY_STYLE.edges,
      transparent: !DEFAULT_DISPLAY_STYLE.transparent,
      mesh: !DEFAULT_DISPLAY_STYLE.mesh,
      ao: !DEFAULT_DISPLAY_STYLE.ao,
    });
    expect(s.writes()).toBe(5);
  });

  it('works without storage', () => {
    const c = createDisplayStyleController({ storage: null });
    expect(c.style.value).toEqual(DEFAULT_DISPLAY_STYLE);
    c.toggleMesh();
    expect(c.style.value.mesh).toBe(true);
  });
});
