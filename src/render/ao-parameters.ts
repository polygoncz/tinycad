// Settings and parameters of the ambient occlusion pass (spec 09, "Víceprůchodové vykreslování
// (AO)", "Nastavení a parametry"; Q081). No three import: tested in Node. The radius and thickness
// are held in pixels like the dashes of hidden edges, so the AO looks the same at every zoom and
// size of the model.

/** The user's settings of AO: a page preference like the display style, but separate (Q081). */
export interface AoSettings {
  /** Radius in CSS px. */
  readonly radiusPx: number;
  /** Strength of the multiplication, 0..1. */
  readonly intensity: number;
  /** Thickness in CSS px (advanced). */
  readonly thicknessPx: number;
  /** 0..1 (advanced). */
  readonly distanceFallOff: number;
  /** Unitless (advanced). */
  readonly scale: number;
  /** Samples of GTAO, a whole number (advanced). */
  readonly samples: number;
}

/** Proposed defaults, tuned during the manual check of M23. */
export const DEFAULT_AO_SETTINGS: AoSettings = Object.freeze({
  radiusPx: 32,
  intensity: 1,
  thicknessPx: 16,
  distanceFallOff: 1,
  scale: 1,
  samples: 16,
});

/** Range of one setting: the slider and the validation. */
export interface AoSettingRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Only whole numbers: the validation, the rounding in ui and the shown value. */
  readonly integer: boolean;
}

function range(min: number, max: number, step: number, integer = false): AoSettingRange {
  return Object.freeze({ min, max, step, integer });
}

/** Ranges of the sliders and of the validation; the only place where they are. */
export const AO_SETTING_RANGES: Readonly<Record<keyof AoSettings, AoSettingRange>> = Object.freeze({
  radiusPx: range(4, 128, 1),
  intensity: range(0, 1, 0.05),
  thicknessPx: range(1, 64, 1),
  distanceFallOff: range(0, 1, 0.05),
  scale: range(0, 3, 0.05),
  samples: range(4, 32, 1, true),
});

/** A valid value of a field: a finite number in its range; a whole one when `integer`. */
export function isValidAoSetting(key: keyof AoSettings, value: number): boolean {
  const { min, max, integer } = AO_SETTING_RANGES[key];
  if (!Number.isFinite(value) || value < min || value > max) return false;
  return !integer || Number.isInteger(value);
}

/** Values for GTAOPass.updateGtaoMaterial and the blend (GTAOBlendShader). */
export interface AoParameters {
  /** World units (mm). */
  readonly radius: number;
  /** World units (mm). */
  readonly thickness: number;
  /** 0..1, unitless. */
  readonly distanceFallOff: number;
  /** Unitless. */
  readonly scale: number;
  /** Samples of GTAO, a whole number. */
  readonly samples: number;
  /** 0..1, strength of the multiplication. */
  readonly intensity: number;
}

/**
 * radius = radiusPx · worldPerPx, thickness = thicknessPx · worldPerPx; the other fields come from
 * the settings unchanged. worldPerPx must be finite and positive.
 */
export function aoParameters(settings: AoSettings, worldPerPx: number): AoParameters {
  if (!(worldPerPx > 0) || !Number.isFinite(worldPerPx)) {
    throw new Error(`Invalid size of a pixel ${String(worldPerPx)}`);
  }
  return Object.freeze({
    radius: settings.radiusPx * worldPerPx,
    thickness: settings.thicknessPx * worldPerPx,
    distanceFallOff: settings.distanceFallOff,
    scale: settings.scale,
    samples: settings.samples,
    intensity: settings.intensity,
  });
}
