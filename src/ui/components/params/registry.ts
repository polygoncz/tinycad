import type { Component } from 'vue';
import type { ParamSpec } from '@/document';
import AngleField from './AngleField.vue';
import AxisField from './AxisField.vue';
import BoolField from './BoolField.vue';
import EnumField from './EnumField.vue';
import LengthField from './LengthField.vue';
import NumberField from './NumberField.vue';
import PointField from './PointField.vue';
import RefListField from './RefListField.vue';

// ParamSpec.kind → field component (spec 11, "Komponenty"). A new kind of param = a new
// component and one line here; a new feature type = nothing in ui. Every field takes
// `field: FieldState` and reports changes with `update`; it never changes anything itself.

/** 'data' never has a component, the dialog skips its field (M12). */
export type ParamFieldKind = Exclude<ParamSpec['kind'], 'data'>;

export const PARAM_FIELDS: Readonly<Record<ParamFieldKind, Component>> = Object.freeze({
  length: LengthField,
  angle: AngleField,
  number: NumberField,
  boolean: BoolField,
  enum: EnumField,
  point: PointField,
  bodies: RefListField,
  topo: RefListField,
  // The count only, without chips; the plane is picked in the Browser (M12).
  planes: RefListField,
  // The count only, without chips; the regions are filled in the view (M13, R77).
  region: RefListField,
  axis: AxisField,
});

/** The component of a param kind, undefined for kinds without one yet. */
export function paramFieldFor(kind: ParamSpec['kind']): Component | undefined {
  return kind === 'data' ? undefined : PARAM_FIELDS[kind];
}
