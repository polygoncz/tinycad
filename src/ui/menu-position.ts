// Placement of a ContextMenu in the window (M19.1, revision C1): a pure function of the anchor (the
// click or the corner under a button), the measured size of the menu and the size of the window,
// kept out of ContextMenu.vue so it runs in Node tests. All in viewport px (position: fixed).

/** A point in viewport px. */
export interface MenuAnchor {
  readonly x: number;
  readonly y: number;
}

/** A width and a height in px: of the menu, or of the window. */
export interface MenuSize {
  readonly width: number;
  readonly height: number;
}

/** The top left corner of the menu in viewport px. */
export interface MenuPlacement {
  readonly left: number;
  readonly top: number;
}

/**
 * Where the menu of `size` opens from `anchor` in a window of `viewport`: right of and below the
 * anchor when it fits there (with `margin` from the window edge), otherwise turned to the left of
 * it and / or up from it. The result is then moved into [margin, viewport − size − margin]; a menu
 * larger than the window sticks to the top left margin, so its start stays visible.
 */
export function placeMenu(
  anchor: MenuAnchor,
  size: MenuSize,
  viewport: MenuSize,
  margin = 8,
): MenuPlacement {
  return {
    left: placeOnAxis(anchor.x, size.width, viewport.width, margin),
    top: placeOnAxis(anchor.y, size.height, viewport.height, margin),
  };
}

/** One axis of placeMenu: after the anchor when it fits, else before it; clamped into the room. */
function placeOnAxis(anchor: number, length: number, room: number, margin: number): number {
  const start = anchor + length <= room - margin ? anchor : anchor - length;
  // min first, then max: too little room (max < margin) gives the margin.
  return Math.max(margin, Math.min(start, room - length - margin));
}
