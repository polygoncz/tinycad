import { describe, expect, expectTypeOf, it } from 'vitest';
import { NO_VARIABLES, evaluateParams } from '@/document';
import type { Evaluated, FeatureSchema, ParamIssue } from '@/document';
import { validateAgainstSchema } from '@/document/validate';

interface SizeParams {
  readonly size: number;
}

const sizeSchema: FeatureSchema<SizeParams> = {
  type: 'cube',
  version: 1,
  label: 'cube.label',
  params: { size: { kind: 'length', label: 'cube.size', default: 1, min: 0, exclusiveMin: true } },
  defaults: () => ({ size: 1 }),
  validate: (raw) => validateAgainstSchema(sizeSchema.params, raw),
};

describe('evaluateParams', () => {
  it('passes valid params through with the same values and no issues', () => {
    const params = { size: 5 };
    const result = evaluateParams(sizeSchema, params, NO_VARIABLES);
    expect(result.issues).toEqual([]);
    expect(result.params).toEqual({ size: 5 });
  });

  it('gives null params and the issues of schema.validate for invalid params', () => {
    const params = { size: -1 };
    const result = evaluateParams(sizeSchema, params, NO_VARIABLES);
    expect(result.params).toBeNull();
    expect(result.issues).toEqual(sizeSchema.validate(params));
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('gives null params for params that are not an object at all', () => {
    const result = evaluateParams(sizeSchema, 'nope', NO_VARIABLES);
    expect(result.params).toBeNull();
    expect(result.issues).toEqual(sizeSchema.validate('nope'));
  });

  it('calls the own validate of the schema, not only the generic checks', () => {
    const issue: ParamIssue = { param: 'size', code: 'cube.odd' };
    const strict: FeatureSchema<SizeParams> = { ...sizeSchema, validate: () => [issue] };
    const result = evaluateParams(strict, { size: 5 }, NO_VARIABLES);
    expect(result).toEqual({ params: null, issues: [issue] });
  });

  it('types the params of the result as Evaluated<P>', () => {
    const result = evaluateParams(sizeSchema, { size: 5 }, NO_VARIABLES);
    expectTypeOf(result.params).toEqualTypeOf<Evaluated<SizeParams> | null>();
    expectTypeOf(result.issues).toEqualTypeOf<readonly ParamIssue[]>();
  });
});

describe('Evaluated', () => {
  it('can be used as P, but P cannot be used as Evaluated<P>', () => {
    expectTypeOf<Evaluated<SizeParams>>().toExtend<SizeParams>();
    expectTypeOf<SizeParams>().not.toExtend<Evaluated<SizeParams>>();
  });
});

describe('NO_VARIABLES', () => {
  it('is empty and frozen', () => {
    expect(NO_VARIABLES.size).toBe(0);
    expect(Object.isFrozen(NO_VARIABLES)).toBe(true);
  });
});
