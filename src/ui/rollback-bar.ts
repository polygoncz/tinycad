// The rollback bar under the pointer while it is dragged in the Timeline (M19.1, revision C2): a
// pure function of the pointer x and the measured boxes of the features, kept out of Timeline.vue
// so it runs in Node tests. All in viewport px (getBoundingClientRect).

/** The horizontal extent of one feature of the Timeline; a DOMRect fits. */
export interface ItemSpan {
  readonly left: number;
  readonly width: number;
}

/**
 * The rollback index under the pointer at `x`: the number of features whose centre lies left of
 * it, so in 0..items.length. A pointer right on a centre stays before that feature. The boxes are
 * the real ones, including the shift of the features after the bar by its width, so the bar jumps
 * a step only once the pointer passes the middle of the next feature.
 */
export function rollbackIndexAt(x: number, items: readonly ItemSpan[]): number {
  return items.filter((item) => x > item.left + item.width / 2).length;
}
