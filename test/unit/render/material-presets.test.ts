import { describe, expect, it } from 'vitest';
import type { BodyMaterial } from '@/interaction';
import {
  MATERIAL_PRESETS,
  materialPreset,
  REALISTIC_EXPOSURE,
  physicalColor,
  type PhysicalPreset,
} from '@/render/material-presets';

const MATERIALS: readonly BodyMaterial[] = [
  'plastic',
  'aluminium',
  'steel',
  'brass',
  'glass',
  'rubber',
];

const UNIT_FIELDS = [
  'metalness',
  'roughness',
  'clearcoat',
  'clearcoatRoughness',
  'transmission',
] as const;

describe('MATERIAL_PRESETS', () => {
  it('has a preset for every body material and nothing else', () => {
    expect(Object.keys(MATERIAL_PRESETS).sort()).toEqual([...MATERIALS].sort());
  });

  it('is frozen, the presets too', () => {
    expect(Object.isFrozen(MATERIAL_PRESETS)).toBe(true);
    for (const material of MATERIALS) {
      expect(Object.isFrozen(MATERIAL_PRESETS[material]), material).toBe(true);
    }
  });

  it.each(MATERIALS)('%s has its values in range', (material) => {
    const preset = MATERIAL_PRESETS[material];
    for (const field of UNIT_FIELDS) {
      expect(preset[field], field).toBeGreaterThanOrEqual(0);
      expect(preset[field], field).toBeLessThanOrEqual(1);
    }
    expect(preset.ior).toBeGreaterThanOrEqual(1);
    expect(preset.thickness).toBeGreaterThanOrEqual(0);
    expect(preset.envMapIntensity).toBeGreaterThanOrEqual(0);
    if (preset.baseColor !== null) {
      expect(Number.isInteger(preset.baseColor)).toBe(true);
      expect(preset.baseColor).toBeGreaterThanOrEqual(0);
      expect(preset.baseColor).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('takes the plastic colour from the palette', () => {
    expect(MATERIAL_PRESETS.plastic.baseColor).toBeNull();
  });

  it('has transmission only in glass, with a thickness for the refraction', () => {
    for (const material of MATERIALS) {
      const preset = MATERIAL_PRESETS[material];
      expect(preset.transmission > 0, material).toBe(material === 'glass');
    }
    expect(MATERIAL_PRESETS.glass.thickness).toBeGreaterThan(0);
  });

  it('has a positive exposure', () => {
    expect(REALISTIC_EXPOSURE).toBeGreaterThan(0);
  });
});

describe('physicalColor', () => {
  const metal: PhysicalPreset = { ...MATERIAL_PRESETS.steel, baseColor: 0x112233 };
  const plastic: PhysicalPreset = { ...MATERIAL_PRESETS.plastic, baseColor: null };

  it('the body colour tints the preset, replacing its base colour', () => {
    expect(physicalColor(metal, 0xff0000, 0x00ff00)).toBe(0xff0000);
    expect(physicalColor(plastic, 0xff0000, 0x00ff00)).toBe(0xff0000);
  });

  it('without a body colour the base colour of the preset', () => {
    expect(physicalColor(metal, null, 0x00ff00)).toBe(0x112233);
  });

  it('without a body colour and a base colour the face colour of the palette', () => {
    expect(physicalColor(plastic, null, 0x00ff00)).toBe(0x00ff00);
  });

  it('keeps black as a colour, not as missing', () => {
    expect(physicalColor(plastic, 0x000000, 0x00ff00)).toBe(0x000000);
    expect(physicalColor({ ...plastic, baseColor: 0 }, null, 0x00ff00)).toBe(0);
  });
});

describe('materialPreset', () => {
  it('returns the preset of a material', () => {
    for (const material of MATERIALS)
      expect(materialPreset(material)).toBe(MATERIAL_PRESETS[material]);
  });

  it('throws for a value without a preset', () => {
    // Values from outside the type, as a corrupt input would bring them.
    expect(() => materialPreset('wood' as BodyMaterial)).toThrow();
    expect(() => materialPreset('toString' as BodyMaterial)).toThrow();
  });
});
