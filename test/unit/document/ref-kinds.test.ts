import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ParamSpec, RefParamKind, RefParamSpec } from '@/document';
import { REF_PARAM_KINDS, isRefParamSpec, rulesOf } from '@/document/ref-kinds';
import type { RefParamKindRules, RefParamSpecOf } from '@/document/ref-kinds';

const REF_KINDS = ['axis', 'bodies', 'planes', 'region', 'topo'] as const;

const VALUE_SPECS: readonly ParamSpec[] = [
  { kind: 'length', label: 'Width', default: 10 },
  { kind: 'angle', label: 'Angle', default: 0 },
  { kind: 'number', label: 'Count', default: 1 },
  { kind: 'boolean', label: 'Flip', default: false },
  { kind: 'enum', label: 'Mode', default: 'a', options: [{ value: 'a', label: 'A' }] },
  { kind: 'point', label: 'Origin', default: [0, 0, 0] },
  { kind: 'data', label: 'Sketch' },
];

const REF_SPECS: readonly RefParamSpec[] = [
  { kind: 'bodies', label: 'Targets' },
  { kind: 'topo', label: 'Edges', entity: 'edge' },
  { kind: 'region', label: 'Profile' },
  { kind: 'planes', label: 'Plane' },
  { kind: 'axis', label: 'Axis' },
];

describe('RefParamKind (M20)', () => {
  it('is the kinds of ParamSpec that hold references', () => {
    expectTypeOf<RefParamKind>().toEqualTypeOf<'bodies' | 'topo' | 'region' | 'planes' | 'axis'>();
    expectTypeOf<RefParamSpec>().toExtend<ParamSpec>();
  });
});

describe('REF_PARAM_KINDS', () => {
  it('has one frozen entry per reference kind, at runtime too', () => {
    expect(Object.keys(REF_PARAM_KINDS).sort()).toEqual([...REF_KINDS]);
    expect(Object.isFrozen(REF_PARAM_KINDS)).toBe(true);
    for (const rules of Object.values(REF_PARAM_KINDS)) {
      expect(Object.isFrozen(rules)).toBe(true);
      expect(Object.isFrozen(rules.refKinds)).toBe(true);
    }
  });

  it('a table without one kind is a type error', () => {
    const incomplete = {
      bodies: REF_PARAM_KINDS.bodies,
      topo: REF_PARAM_KINDS.topo,
      region: REF_PARAM_KINDS.region,
      planes: REF_PARAM_KINDS.planes,
    };
    // @ts-expect-error -- 'axis' is missing
    const table = incomplete satisfies {
      readonly [K in RefParamKind]: RefParamKindRules<RefParamSpecOf<K>>;
    };
    expect(Object.keys(table)).not.toContain('axis');
  });

  it.each([
    ['bodies', ['body']],
    ['topo', ['topo']],
    ['region', ['region']],
    // A plane of the history or a planar face of a body (M14).
    ['planes', ['plane', 'topo']],
    // An origin axis or a line of a sketch (M13).
    ['axis', ['axis', 'sketchEntity']],
  ] as const)('%s holds the references %j', (kind, refKinds) => {
    expect(REF_PARAM_KINDS[kind].refKinds).toEqual(refKinds);
  });

  it.each(['bodies', 'topo', 'region', 'planes'] as const)(
    '%s: the items are the array, a value that is not an array has none',
    (kind) => {
      const items = [{ kind: 'x' }, 1];
      expect(REF_PARAM_KINDS[kind].items(items)).toEqual(items);
      expect(REF_PARAM_KINDS[kind].items(null)).toEqual([]);
      expect(REF_PARAM_KINDS[kind].items({ kind: 'body' })).toEqual([]);
    },
  );

  it('axis: the item is the single value, null and undefined have none', () => {
    const ref = { kind: 'axis', axis: 'origin/axis:z' };
    expect(REF_PARAM_KINDS.axis.items(ref)).toEqual([ref]);
    expect(REF_PARAM_KINDS.axis.items(null)).toEqual([]);
    expect(REF_PARAM_KINDS.axis.items(undefined)).toEqual([]);
  });

  it('a list kind checks the array, the references, duplicates and the count', () => {
    const spec: RefParamSpec = { kind: 'bodies', label: 'Targets', min: 1, max: 2 };
    const a = { kind: 'body', body: 'f1/body' };
    const b = { kind: 'body', body: 'f2/body' };
    const c = { kind: 'body', body: 'f3/body' };
    const rules = rulesOf(spec);
    expect(rules.check([a, b], spec)).toBeUndefined();
    expect(rules.check('x', spec)).toEqual({ code: 'param.wrongType' });
    expect(rules.check([a, { kind: 'body' }], spec)).toEqual({
      code: 'param.invalidRef',
      params: { index: 1 },
    });
    expect(rules.check([a, a], spec)).toEqual({ code: 'param.duplicateRef', params: { index: 1 } });
    expect(rules.check([], spec)).toEqual({ code: 'param.tooFewRefs', params: { min: 1 } });
    expect(rules.check([a, b, c], spec)).toEqual({
      code: 'param.tooManyRefs',
      params: { max: 2 },
    });
  });

  it('axis checks a single required reference', () => {
    const spec: RefParamSpec = { kind: 'axis', label: 'Axis' };
    const rules = rulesOf(spec);
    expect(rules.check({ kind: 'axis', axis: 'origin/axis:z' }, spec)).toBeUndefined();
    expect(rules.check({ kind: 'sketchEntity', sketch: 's1', entity: 'ab' }, spec)).toBeUndefined();
    expect(rules.check(null, spec)).toEqual({ code: 'param.tooFewRefs', params: { min: 1 } });
    expect(rules.check([], spec)).toEqual({ code: 'param.invalidRef' });
  });
});

describe('isRefParamSpec / rulesOf', () => {
  it.each(REF_SPECS)('$kind is a reference param with the rules of its kind', (spec) => {
    expect(isRefParamSpec(spec)).toBe(true);
    expect(rulesOf(spec)).toBe(REF_PARAM_KINDS[spec.kind]);
  });

  it.each(VALUE_SPECS)('$kind is not a reference param', (spec) => {
    expect(isRefParamSpec(spec)).toBe(false);
  });
});
