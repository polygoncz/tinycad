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
  /** Both palettes: the mockup's red, green and blue. */
  readonly axes: readonly [x: number, y: number, z: number];
  readonly grid: readonly [center: number, line: number];
}

function freezePalette(palette: ScenePalette): ScenePalette {
  Object.freeze(palette.axes);
  Object.freeze(palette.grid);
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
  axes: [0xff3b30, 0x34c759, 0x0a84ff],
  grid: [0xb4b9c1, 0xd5d8dd],
});

/** By the M10 mockup (spec 11, "Rozvržení"). */
export const DARK_PALETTE: ScenePalette = freezePalette({
  background: 0x1f2023,
  face: 0x3b6aa6,
  edge: 0x9cc3f5,
  hover: 0x5e9ff5,
  selection: 0x0a84ff,
  preview: 0x0a84ff,
  construction: 0x6b7280,
  axes: [0xff3b30, 0x34c759, 0x0a84ff],
  // Muted on the dark background.
  grid: [0x3a3c42, 0x2c2e33],
});
