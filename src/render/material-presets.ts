// Physical presets of the body materials (spec 09, "Realistic", ADR 0027). No three import: the
// values and the colour rule are tested in Node; physical-materials.ts builds the three materials.

import type { BodyMaterial } from '@/interaction';

/** The values of a MeshPhysicalMaterial for one body material. */
export interface PhysicalPreset {
  /** 0xRRGGBB; null = the face colour of the palette (plastic). */
  readonly baseColor: number | null;
  readonly metalness: number;
  readonly roughness: number;
  readonly clearcoat: number;
  readonly clearcoatRoughness: number;
  /** > 0 only for glass. */
  readonly transmission: number;
  readonly ior: number;
  /** mm, for the refraction in glass. */
  readonly thickness: number;
  readonly envMapIntensity: number;
}

/** The fields every preset shares; the table below lists only what differs. */
const COMMON = {
  clearcoat: 0,
  clearcoatRoughness: 0.2,
  transmission: 0,
  ior: 1.5,
  thickness: 0,
  envMapIntensity: 1,
} as const;

/** A frozen preset from the common fields and the differing ones. */
function preset(
  fields: Partial<PhysicalPreset> & Pick<PhysicalPreset, 'baseColor' | 'metalness' | 'roughness'>,
): PhysicalPreset {
  return Object.freeze({ ...COMMON, ...fields });
}

/**
 * The presets by spec 09. The values are a proposal tuned at the manual check of M24; the tests
 * guard completeness and ranges, not the numbers.
 */
export const MATERIAL_PRESETS: Readonly<Record<BodyMaterial, PhysicalPreset>> = Object.freeze({
  plastic: preset({ baseColor: null, metalness: 0, roughness: 0.45, clearcoat: 0.3 }),
  aluminium: preset({ baseColor: 0xd2d6db, metalness: 1, roughness: 0.35 }),
  steel: preset({ baseColor: 0xa9afb6, metalness: 1, roughness: 0.25 }),
  brass: preset({ baseColor: 0xc9a24a, metalness: 1, roughness: 0.3 }),
  glass: preset({
    baseColor: 0xffffff,
    metalness: 0,
    roughness: 0.05,
    transmission: 1,
    thickness: 2,
  }),
  rubber: preset({ baseColor: 0x2c2e31, metalness: 0, roughness: 0.9 }),
});

/**
 * The preset of a body material. A value from outside BodyMaterial (a corrupt input that slipped
 * past the type) throws.
 */
export function materialPreset(material: BodyMaterial): PhysicalPreset {
  if (!Object.hasOwn(MATERIAL_PRESETS, material)) {
    throw new Error(`Unknown body material: ${material}`);
  }
  return MATERIAL_PRESETS[material];
}

/**
 * The colour of a physical material: the body colour tints the preset (replaces baseColor),
 * otherwise baseColor, otherwise the face colour of the palette.
 */
export function physicalColor(
  preset: PhysicalPreset,
  bodyColor: number | null,
  paletteFace: number,
): number {
  return bodyColor ?? preset.baseColor ?? paletteFace;
}

/** The exposure of the AgX tone mapping in the shader of the physical materials. */
export const REALISTIC_EXPOSURE = 1;
