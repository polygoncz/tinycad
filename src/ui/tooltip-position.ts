// Placement of a tooltip in the window (M19.2 D9): a pure function of the box of the anchor, the
// measured size of the tooltip and the size of the window, kept out of the components so it runs
// in Node tests. All in viewport px (position: fixed, getBoundingClientRect).

/** The box of the anchor in viewport px; a DOMRect fits. */
export interface TooltipAnchor {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A width and a height in px: of the tooltip, or of the window. */
export interface TooltipSize {
  readonly width: number;
  readonly height: number;
}

/** The top left corner of the tooltip in viewport px. */
export interface TooltipPlacement {
  readonly left: number;
  readonly top: number;
}

/**
 * Where a tooltip of `size` stands at `anchor` in a window of `viewport`: above the anchor with
 * `gap` between, centred on it horizontally. Horizontally it is moved into
 * [margin, viewport − size − margin] (one wider than the window sticks to the left margin); when it
 * does not fit above (with `margin` from the top), it goes below the anchor instead.
 */
export function placeTooltip(
  anchor: TooltipAnchor,
  size: TooltipSize,
  viewport: TooltipSize,
  gap = 8,
  margin = 8,
): TooltipPlacement {
  const centred = anchor.left + anchor.width / 2 - size.width / 2;
  // min first, then max: too little room gives the margin.
  const left = Math.max(margin, Math.min(centred, viewport.width - size.width - margin));
  const above = anchor.top - gap - size.height;
  const top = above >= margin ? above : anchor.top + anchor.height + gap;
  return { left, top };
}
