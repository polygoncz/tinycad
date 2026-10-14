// Keyboard focus in a ContextMenu (M19.1, revision C1): which item gets the focus after a key, as a
// pure function of the enabled flags of the items, kept out of ContextMenu.vue so it runs in Node
// tests. Disabled items cannot take the focus, so every key skips them.

/** The keys that move the focus between the items of a menu. */
export type MenuNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

const NAVIGATION_KEYS: ReadonlySet<string> = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/** Whether `key` (KeyboardEvent.key) moves the focus in a menu. */
export function isMenuNavigationKey(key: string): key is MenuNavigationKey {
  return NAVIGATION_KEYS.has(key);
}

/**
 * The index of the item that gets the focus after `key` in a menu whose items are `enabled`
 * (false = disabled); `current` is the index of the focused item, null = none of them.
 * - Home / End: the first / the last enabled item.
 * - ArrowDown / ArrowUp: the next / the previous enabled item; past the last / the first one the
 *   focus stays on it (no wrap). Without a focused item ArrowDown goes to the first and ArrowUp to
 *   the last enabled item.
 * No enabled item → null.
 */
export function menuFocusIndex(
  enabled: readonly boolean[],
  current: number | null,
  key: MenuNavigationKey,
): number | null {
  const first = enabled.indexOf(true);
  if (first === -1) return null;
  const last = enabled.lastIndexOf(true);
  switch (key) {
    case 'Home':
      return first;
    case 'End':
      return last;
    case 'ArrowDown': {
      if (current === null) return first;
      const next = enabled.findIndex((on, i) => on && i > current);
      return next === -1 ? last : next;
    }
    case 'ArrowUp': {
      if (current === null) return last;
      const previous = enabled.findLastIndex((on, i) => on && i < current);
      return previous === -1 ? first : previous;
    }
  }
}
