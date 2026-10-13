import { describe, expect, it } from 'vitest';
import type { ParamSpec } from '@/document';
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
} as const satisfies Record<ParamSpec['kind'], true>;

// region comes with the sketcher (M12); decided 2026-10-13.
const WITHOUT_COMPONENT: readonly ParamSpec['kind'][] = ['region'];

const kinds = Object.keys(ALL_KINDS) as ParamSpec['kind'][]; // keys of a literal typed above

describe('ParamField registry', () => {
  it.each(kinds.filter((k) => !WITHOUT_COMPONENT.includes(k)))('%s has a component', (kind) => {
    expect(paramFieldFor(kind)).toBeDefined();
  });

  it('region has no component yet', () => {
    expect(paramFieldFor('region')).toBeUndefined();
  });

  it('has no entries beyond the ParamSpec kinds', () => {
    for (const key of Object.keys(PARAM_FIELDS)) expect(kinds).toContain(key);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(PARAM_FIELDS)).toBe(true);
  });
});
