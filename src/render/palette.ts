// Colours of the scene (spec 09, "Viewport", Q072). A plain value, no CSS: render knows no DOM.
// The app picks the palette by the UI theme and hands it to Viewport.setPalette.

/** Colours of the scene as 0xRRGGBB. */
export interface ScenePalette {
  readonly background: number;
  readonly face: number;
  readonly edge: number;
  /** A lighter shade of selection (M19.2 D1). */
  readonly hover: number;
  /**
   * Orange, apart from the RGB axes and the default face colour (M19.2 D1). Not --accent in
   * CSS: the scene selection and the accent of the controls are two different roles.
   */
  readonly selection: number;
  /** Overlay of tools (the rubber band of the sketch tools: blue like the sketch). */
  readonly preview: number;
  /**
   * The preview of the edited feature (M21, spec 09 "Náhled"): amber, apart from the bodies, the
   * selection, the hover and the tool overlay, with a contrast of at least 3:1 to the background.
   */
  readonly bodyPreview: number;
  readonly construction: number;
  /** Under-defined sketch (M12). */
  readonly sketch: number;
  /** Fully defined sketch (M12). */
  readonly sketchDefined: number;
  /** Both palettes: the mockup's red, green and blue. */
  readonly axes: readonly [x: number, y: number, z: number];
  readonly grid: readonly [center: number, line: number];
  /** View cube (M17): colour of its faces and of the face labels and arrows. */
  readonly viewCube: readonly [face: number, text: number];
  /** Dashed hidden edges (M22, spec 09 "Styl zobrazení"). */
  readonly hiddenEdge: number;
  /** Lines of the triangulation (M22, spec 09 "Styl zobrazení"). */
  readonly meshLine: number;
  /** Vertical gradient behind the bodies in Realistic (M24, spec 09 "Realistic"). */
  readonly realisticBackground: readonly [top: number, bottom: number];
}

function freezePalette(palette: ScenePalette): ScenePalette {
  Object.freeze(palette.axes);
  Object.freeze(palette.grid);
  Object.freeze(palette.viewCube);
  Object.freeze(palette.realisticBackground);
  return Object.freeze(palette);
}

export const LIGHT_PALETTE: ScenePalette = freezePalette({
  background: 0xf3f4f6,
  face: 0xb9c3d1,
  edge: 0x1f2328,
  hover: 0xfb923c,
  selection: 0xea580c,
  preview: 0x2563eb,
  // A dark amber: a light amber (#ffcc00) has a contrast of 1.5:1 to the light background.
  bodyPreview: 0xb07d0a,
  construction: 0x6b7280,
  sketch: 0x0a84ff,
  sketchDefined: 0x1c1c1e,
  axes: [0xff3b30, 0x34c759, 0x0a84ff],
  grid: [0xb4b9c1, 0xd5d8dd],
  viewCube: [0xffffff, 0x374151],
  hiddenEdge: 0x8b929c,
  meshLine: 0x8e99a8,
  realisticBackground: [0xf4f6f9, 0xd9dee5],
});

/** By the M10 mockup (spec 11, "Rozvržení"). */
export const DARK_PALETTE: ScenePalette = freezePalette({
  background: 0x1f2023,
  face: 0x3b6aa6,
  edge: 0x9cc3f5,
  hover: 0xffc266,
  selection: 0xff9f0a,
  preview: 0x0a84ff,
  // The system yellow of the mockup's colour set; yellower than the orange selection and hover.
  bodyPreview: 0xffd60a,
  construction: 0x6b7280,
  sketch: 0x409cff,
  sketchDefined: 0xf2f2f7,
  axes: [0xff3b30, 0x34c759, 0x0a84ff],
  // Muted on the dark background.
  grid: [0x3a3c42, 0x2c2e33],
  viewCube: [0x4b4f57, 0xe5e7eb],
  hiddenEdge: 0x6b7280,
  meshLine: 0x5a7fb0,
  realisticBackground: [0x3a3f47, 0x1c1f24],
});

/**
 * '#rrggbb' (lower case, the canonical form of a body colour in the document) → 0xRRGGBB.
 * Anything else is a bug of the caller and throws: the document validates colours already.
 * The pattern repeats isBodyColor from document on purpose: render may import only types from
 * document (spec 01), so this is a guard, not a second source of the rule (R136).
 */
export function parseHexColor(text: string): number {
  if (!/^#[0-9a-f]{6}$/.test(text)) throw new Error(`Invalid colour ${JSON.stringify(text)}`);
  return Number.parseInt(text.slice(1), 16);
}

/** 0xRRGGBB → '#rrggbb' for the DOM parts of render (arrows of the view cube). */
export function toCssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
