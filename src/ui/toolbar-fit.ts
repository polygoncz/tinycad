// The overflow of the Toolbar (M19.1, revision C10): how many groups from the left fit into the
// bar; the rest goes into the menu of the button "…". A pure function of the measured widths,
// kept out of Toolbar.vue so it runs in Node tests. All in px; the width of a group includes its
// separator, the width of the button "…" its own.

/**
 * The number of groups from the left that fit into `available`. When all of them fit, all of
 * them (no button "…"); otherwise as many as fit together with the button "…" of `moreWidth`,
 * possibly none.
 */
export function fitGroups(
  groupWidths: readonly number[],
  available: number,
  moreWidth: number,
): number {
  const total = groupWidths.reduce((sum, width) => sum + width, 0);
  if (total <= available) return groupWidths.length;
  let used = moreWidth;
  let count = 0;
  for (const width of groupWidths) {
    used += width;
    if (used > available) break;
    count += 1;
  }
  return count;
}

/**
 * The items of the menu of the button "…": those of the groups from `fitCount` on (the groups
 * out of the bar, fitCount from fitGroups), group after group in their order. All groups in the
 * bar → none.
 */
export function overflowItems<T>(
  groups: readonly { readonly items: readonly T[] }[],
  fitCount: number,
): readonly T[] {
  return Object.freeze(groups.slice(fitCount).flatMap((group) => group.items));
}

/**
 * The items of a menu of the toolbar (of a group, of "…") from items of the bar: the variants of a
 * tool family as plain items in place of its split button (M27), the others as they are.
 */
export function menuEntries<T extends { readonly variants: readonly T[] }>(
  items: readonly T[],
): readonly T[] {
  return Object.freeze(
    items.flatMap((item) => (item.variants.length > 0 ? item.variants : [item])),
  );
}

/**
 * The variants of the tool family with `toolId` in the group `groupId` (the menu of its arrow,
 * M27): found by any tool of the family, so it stays found when the shown variant changes. No
 * such group or family → none.
 */
export function familyVariants<T extends { readonly id: string; readonly variants: readonly T[] }>(
  groups: readonly { readonly id: string; readonly items: readonly T[] }[],
  groupId: string,
  toolId: string,
): readonly T[] {
  const group = groups.find((g) => g.id === groupId);
  const family = group?.items.find((item) => item.variants.some((v) => v.id === toolId));
  return family?.variants ?? [];
}
