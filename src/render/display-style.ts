// Display style of the bodies (spec 09, "Styl zobrazení"): the value chosen in the UI and the flat
// plan the rest of render reads. No three import: resolveDisplay is the only place that decides
// by the mode, tested in Node.

/** How the bodies are drawn. */
export type DisplayMode = 'shaded' | 'realistic' | 'hiddenRemoved' | 'hiddenVisible' | 'wireframe';

/** The modes in menu order. */
export const DISPLAY_MODES: readonly DisplayMode[] = Object.freeze([
  'shaded',
  'realistic',
  'hiddenRemoved',
  'hiddenVisible',
  'wireframe',
]);

/**
 * A page preference like the orbit mode (the UI owns and stores it). A field that does not apply
 * in the current mode is ignored, not cleared: back in shaded, what was set applies again.
 */
export interface DisplayStyle {
  readonly mode: DisplayMode;
  /** B-rep edges; applies only in 'shaded'. */
  readonly edges: boolean;
  /** Translucent faces; applies only in 'shaded'. */
  readonly transparent: boolean;
  /** Lines of the triangulation; applies in every mode. */
  readonly mesh: boolean;
  /** Ambient occlusion; applies in opaque 'shaded' and in 'realistic'. */
  readonly ao: boolean;
}

export const DEFAULT_DISPLAY_STYLE: DisplayStyle = Object.freeze({
  mode: 'shaded',
  edges: true,
  transparent: false,
  mesh: false,
  ao: false,
});

/** Opacity of the faces in transparent shaded. */
export const TRANSPARENT_FACE_OPACITY = 0.35;

/** The flat plan: the only thing render decides by. Frozen. */
export interface DisplayPlan {
  /** 'physical': materials by the body material preset (spec 09, "Realistic"). */
  readonly faces: 'lit' | 'flat' | 'hidden' | 'physical';
  /** 1, or TRANSPARENT_FACE_OPACITY. */
  readonly faceOpacity: number;
  /** Visible B-rep edges. */
  readonly edges: boolean;
  /** The second pass of the edges behind the faces. */
  readonly hiddenEdges: 'none' | 'dashed';
  readonly meshLines: boolean;
  /** Picking skips the occlusion checks, the highlight is drawn without the depth test. */
  readonly xray: boolean;
  /** The AO pass (spec 09, "Víceprůchodové vykreslování"). */
  readonly ao: boolean;
  /** The grid and a background colour, or the environment of Realistic (spec 09, "Realistic"). */
  readonly scene: 'studio' | 'realistic';
}

/** The plan of a style by the decision table of spec 09. */
export function resolveDisplay(style: DisplayStyle): DisplayPlan {
  const meshLines = style.mesh;
  switch (style.mode) {
    case 'shaded':
      return Object.freeze({
        faces: 'lit',
        faceOpacity: style.transparent ? TRANSPARENT_FACE_OPACITY : 1,
        edges: style.edges,
        hiddenEdges: 'none',
        meshLines,
        // Transparent faces write no depth, so the edges behind them show: pick what you see.
        xray: style.transparent,
        // Transparent faces write no depth: AO from the depth would draw dark blots under them.
        ao: style.ao && !style.transparent,
        scene: 'studio',
      });
    case 'realistic':
      // No edges, and transparency only as the glass material: style.edges and style.transparent
      // are ignored here.
      return Object.freeze({
        faces: 'physical',
        faceOpacity: 1,
        edges: false,
        hiddenEdges: 'none',
        meshLines,
        xray: false,
        ao: style.ao,
        scene: 'realistic',
      });
    case 'hiddenRemoved':
      return Object.freeze({
        faces: 'flat',
        faceOpacity: 1,
        edges: true,
        hiddenEdges: 'none',
        meshLines,
        xray: false,
        ao: false,
        scene: 'studio',
      });
    case 'hiddenVisible':
      return Object.freeze({
        faces: 'flat',
        faceOpacity: 1,
        edges: true,
        hiddenEdges: 'dashed',
        meshLines,
        xray: true,
        ao: false,
        scene: 'studio',
      });
    case 'wireframe':
      return Object.freeze({
        faces: 'hidden',
        faceOpacity: 1,
        edges: true,
        hiddenEdges: 'none',
        meshLines,
        xray: true,
        ao: false,
        scene: 'studio',
      });
  }
}

/**
 * Whether the AO pass really draws in the style: the ao of its plan. The UI derives from it
 * whether AO draws and whether the AO toggle means something, without repeating the table.
 */
export function displayDrawsAo(style: DisplayStyle): boolean {
  return resolveDisplay(style).ao;
}

/**
 * Structural equality of two plans. Over the keys of the plan, not a hand-written list, so a
 * field added later cannot be forgotten here. Every field is a primitive, so === suffices.
 */
export function samePlan(a: DisplayPlan, b: DisplayPlan): boolean {
  // Object.keys gives string[]; the keys of a DisplayPlan are exactly its fields.
  return (Object.keys(a) as (keyof DisplayPlan)[]).every((key) => a[key] === b[key]);
}
