import { describe, expect, it } from 'vitest';
import { BODY_MATERIALS } from '@/app';
import { bodyMaterialMenuItems } from '@/ui/body-material';
import { cs } from '@/ui/i18n/cs';
import { en } from '@/ui/i18n/en';

describe('bodyMaterialMenuItems', () => {
  it('lists BODY_MATERIALS in order with the bodyMaterial.<id> labels', () => {
    expect(
      bodyMaterialMenuItems('plastic').map(({ material, label }) => ({ material, label })),
    ).toEqual(BODY_MATERIALS.map((material) => ({ material, label: `bodyMaterial.${material}` })));
  });

  it.each(BODY_MATERIALS)('checks exactly the current material %s', (current) => {
    const checked = bodyMaterialMenuItems(current).filter((item) => item.checked);
    expect(checked.map((item) => item.material)).toEqual([current]);
  });

  it('has a text for every label in both languages', () => {
    for (const item of bodyMaterialMenuItems('plastic')) {
      expect(cs[item.label], item.label).toBeTypeOf('string');
      expect(en[item.label], item.label).toBeTypeOf('string');
    }
  });

  it('has the button label browser.materialCurrent in both languages', () => {
    expect(cs['browser.materialCurrent']).toBe('Materiál {name}: {material}');
    expect(en['browser.materialCurrent']).toBe('Material of {name}: {material}');
  });
});
