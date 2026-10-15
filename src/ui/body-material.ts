import { BODY_MATERIALS } from '@/app';
import type { BodyMaterial } from '@/app';

// The material menu of a body row in the Browser (spec 11, "Materiál tělesa", M24): its items as
// a pure function of the current material, kept out of BodyMaterialMenu.vue so they run in Node
// tests.

/** An item of the menu: a material as a radio item, checked for the current one. */
export interface BodyMaterialMenuItem {
  readonly material: BodyMaterial;
  /** i18n key. */
  readonly label: string;
  readonly checked: boolean;
}

/** The i18n key of the name of a material. */
export function bodyMaterialLabel(material: BodyMaterial): string {
  return `bodyMaterial.${material}`;
}

/** The items in the order of BODY_MATERIALS; the current material is checked. */
export function bodyMaterialMenuItems(current: BodyMaterial): readonly BodyMaterialMenuItem[] {
  return BODY_MATERIALS.map((material) => ({
    material,
    label: bodyMaterialLabel(material),
    checked: material === current,
  }));
}
