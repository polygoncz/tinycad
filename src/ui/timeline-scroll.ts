// The scroll buttons of the Timeline (M19.2 D10): a pure function of the measured scroll state of
// the items, kept out of Timeline.vue so it runs in Node tests. All in px (scrollLeft,
// clientWidth, scrollWidth of the scroll container).

/** Which scroll buttons the Timeline shows. */
export interface ScrollButtons {
  readonly left: boolean;
  readonly right: boolean;
}

/** Sub-pixel scroll positions (zoom, fractional layout) still count as the end. */
const TOLERANCE = 1;

/**
 * The buttons of a scroll container: "‹" when there is content left of the visible part, "›" when
 * there is some right of it. Within 1 px of an end nothing is hidden there, so no button.
 */
export function scrollButtons(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): ScrollButtons {
  return {
    left: scrollLeft > TOLERANCE,
    right: scrollWidth - clientWidth - scrollLeft > TOLERANCE,
  };
}
