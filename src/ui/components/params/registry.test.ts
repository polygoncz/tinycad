import { describe, expect, it } from 'vitest';
import type { ParamSpec } from '@/document';
import AxisField from './AxisField.vue';
import RefListField from './RefListField.vue';
import { paramFieldFor, PARAM_FIELDS } from './registry';

// Every ParamSpec kind, checked against the type: a new kind fails typecheck here until it is
// listed, and then this test until it has a component (spec 11, "Komponenty").
const ALL_KINDS = {
  length: true,
  angle: true,
  number: true,
  boolean: true,
  enum: true,
  point: true,
  bodies: true,
  topo: true,
  region: true,
  planes: true,
  data: true,
  axis: true,
} as const satisfies Record<ParamSpec['kind'], true>;

// data never has a field (M12).
const WITHOUT_COMPONENT: readonly ParamSpec['kind'][] = ['data'];

const kinds = Object.keys(ALL_KINDS) as ParamSpec['kind'][]; // keys of a literal typed above

describe('ParamField registry', () => {
  it.each(kinds.filter((k) => !WITHOUT_COMPONENT.includes(k)))('%s has a component', (kind) => {
    expect(paramFieldFor(kind)).toBeDefined();
  });

  it.each(WITHOUT_COMPONENT)('%s has no component', (kind) => {
    expect(paramFieldFor(kind)).toBeUndefined();
  });

  it('planes uses the reference list field, like bodies (M12)', () => {
    expect(paramFieldFor('planes')).toBe(paramFieldFor('bodies'));
  });

  it('region uses the reference list field, count only (M13, R77)', () => {
    expect(paramFieldFor('region')).toBe(RefListField);
  });

  it('axis uses the axis field (M13)', () => {
    expect(paramFieldFor('axis')).toBe(AxisField);
  });

  it('has no entries beyond the ParamSpec kinds', () => {
    for (const key of Object.keys(PARAM_FIELDS)) expect(kinds).toContain(key);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(PARAM_FIELDS)).toBe(true);
  });
});
