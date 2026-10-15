import { describe, expect, it } from 'vitest';
import { keyEventToShortcut, parseShortcut } from '@/interaction/shortcut';
import type { KeyMods } from '@/interaction/viewport-port';

const NO_MODS: KeyMods = { shift: false, alt: false, mod: false };

describe('parseShortcut', () => {
  it('parses a modifier and a key into the canonical form', () => {
    expect(parseShortcut('Mod+Z')).toBe('Mod+z');
  });

  it('ignores the order of modifiers', () => {
    expect(parseShortcut('Shift+Mod+Z')).toBe(parseShortcut('Mod+Shift+Z'));
    expect(parseShortcut('Alt+Shift+Mod+Z')).toBe('Mod+Shift+Alt+z');
  });

  it('compares letters case-insensitively', () => {
    expect(parseShortcut('Mod+z')).toBe(parseShortcut('Mod+Z'));
  });

  it('accepts named keys without modifiers', () => {
    expect(parseShortcut('Delete')).toBe('Delete');
    expect(parseShortcut('F2')).toBe('F2');
    expect(parseShortcut('Escape')).toBe('Escape');
  });

  it.each([
    ['unknown modifier', 'Foo+Z'],
    ['missing key', 'Mod+'],
    ['repeated modifier', 'Mod+Mod+Z'],
    ['empty string', ''],
    ['modifier as the key', 'Mod+Shift'],
    ['empty token', 'Mod++Z'],
  ])('throws on %s', (_, shortcut) => {
    expect(() => parseShortcut(shortcut)).toThrow();
  });
});

describe('keyEventToShortcut', () => {
  it('matches the canonical form of the parsed shortcut', () => {
    expect(keyEventToShortcut('z', { ...NO_MODS, mod: true })).toBe(parseShortcut('Mod+Z'));
  });

  it('lower-cases the letter Shift made upper-case', () => {
    expect(keyEventToShortcut('Z', { ...NO_MODS, mod: true, shift: true })).toBe(
      parseShortcut('Mod+Shift+Z'),
    );
  });

  it('keeps named keys as they are', () => {
    expect(keyEventToShortcut('Delete', NO_MODS)).toBe(parseShortcut('Delete'));
  });
});
