// Colours of the scene (spec 09, "Viewport", Q072). A plain value, no CSS: render knows no DOM.
// The app picks the palette by the UI theme and hands it to Viewport.setPalette.

/** Colours of the scene as 0xRRGGBB. */
export interface ScenePalette {
  readonly background: number;
  readonly face: number;
  readonly edge: number;
  readonly hover: number;
  /** Matches --accent in CSS. */
  readonly selection: number;
  /** Overlay of tools. */
  readonly preview: number;
  readonly construction: number;
  readonly axes: readonly [x: number, y: number, z: number];
}

function freezePalette(palette: ScenePalette): ScenePalette {
  Object.freeze(palette.axes);
  return Object.freeze(palette);
}

export const LIGHT_PALETTE: ScenePalette = freezePalette({
  background: 0xf3f4f6,
  face: 0xb9c3d1,
  edge: 0x1f2328,
  hover: 0xf59e0b,
  selection: 0x2563eb,
  preview: 0x2563eb,
  construction: 0x6b7280,
  axes: [0xe53935, 0x43a047, 0x1e88e5],
});

/** By the M10 mockup (spec 11, "Rozvržení"). */
export const DARK_PALETTE: ScenePalette = freezePalette({
  background: 0x1f2023,
  face: 0x3b6aa6,
  edge: 0x9cc3f5,
  hover: 0x5e9ff5,
  selection: 0x0a84ff,
  // Not given by the plan: the light palette also previews in the selection colour.
  preview: 0x0a84ff,
  // Not given by the plan: the light grey kept; it reads on both backgrounds.
  construction: 0x6b7280,
  // Not given by the plan: the light axes kept.
  axes: [0xe53935, 0x43a047, 0x1e88e5],
});
