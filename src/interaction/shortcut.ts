// Keyboard shortcuts (spec 10, "Akce a klávesové zkratky"): parsing of 'Mod+Shift+Z' and
// matching against ViewKeyEvent. Both sides are reduced to one canonical string, so
// matching is a string comparison and duplicates are found by a Map lookup.

import type { KeyMods } from './viewport-port';

type Modifier = 'Mod' | 'Shift' | 'Alt';

// Fixed order of the canonical form; the written order does not matter.
const MODIFIERS: readonly Modifier[] = ['Mod', 'Shift', 'Alt'];

function isModifier(token: string): token is Modifier {
  return (MODIFIERS as readonly string[]).includes(token);
}

/** Letters compare case-insensitively (Shift turns `key` into an upper-case letter). */
function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function canonical(mods: ReadonlySet<Modifier>, key: string): string {
  return [...MODIFIERS.filter((m) => mods.has(m)), normalizeKey(key)].join('+');
}

/**
 * Validates a shortcut and returns its canonical form ('Shift+Mod+Z' → 'Mod+Shift+z').
 * Throws on an unknown or repeated modifier and on a missing key.
 */
export function parseShortcut(shortcut: string): string {
  const tokens = shortcut.split('+');
  const key = tokens[tokens.length - 1] ?? '';
  if (key === '' || isModifier(key)) throw new Error(`Shortcut '${shortcut}' has no key`);
  const mods = new Set<Modifier>();
  for (const token of tokens.slice(0, -1)) {
    if (!isModifier(token))
      throw new Error(`Unknown modifier '${token}' in shortcut '${shortcut}'`);
    if (mods.has(token)) throw new Error(`Repeated modifier '${token}' in shortcut '${shortcut}'`);
    mods.add(token);
  }
  return canonical(mods, key);
}

/** Canonical form of a key event, comparable with the result of parseShortcut. */
export function keyEventToShortcut(key: string, mods: KeyMods): string {
  const set = new Set<Modifier>();
  if (mods.mod) set.add('Mod');
  if (mods.shift) set.add('Shift');
  if (mods.alt) set.add('Alt');
  return canonical(set, key);
}
