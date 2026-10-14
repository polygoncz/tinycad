// The roving focus of a one-row widget (M19.2 D14, the items of the Timeline): which item the
// arrow keys, Home and End move the focus to. A pure function, kept out of the components so it
// runs in Node tests.

/**
 * The index the focus moves to from `index` among `count` items on `key`: ← and → by one, Home
 * to the first, End to the last; no wrapping, at an end it stays. null = the key does not
 * navigate (or there are no items), the caller leaves it alone.
 */
export function rovingNext(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, index - 1);
    case 'ArrowRight':
      return Math.min(count - 1, index + 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * The item with tabindex 0 (the roving tabindex of the Timeline, D14): the first selected one,
 * otherwise the edited one, otherwise the first (0 also for no items).
 */
export function rovingActive(
  items: readonly { readonly selected: boolean; readonly editing: boolean }[],
): number {
  const selected = items.findIndex((item) => item.selected);
  if (selected !== -1) return selected;
  return Math.max(
    0,
    items.findIndex((item) => item.editing),
  );
}
