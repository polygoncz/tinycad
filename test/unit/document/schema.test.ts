import { describe, expect, expectTypeOf, it } from 'vitest';
import { createFeatureSchemaRegistry, isParamVisible } from '@/document/schema';
import type { FeatureSchema, ParamSchema, ParamSchemaOf, ParamSpec } from '@/document/schema';

function schema(type: string, version: number, migrate?: FeatureSchema['migrate']): FeatureSchema {
  return {
    type,
    version,
    label: type,
    params: {},
    defaults: () => ({}),
    validate: () => [],
    ...(migrate && { migrate }),
  };
}

describe('createFeatureSchemaRegistry', () => {
  it('registers and finds schemas by type', () => {
    const registry = createFeatureSchemaRegistry();
    registry.register(schema('box', 1));
    expect(registry.get('box').type).toBe('box');
    expect(registry.find('cylinder')).toBeUndefined();
    expect(registry.has('box')).toBe(true);
    expect(registry.all()).toHaveLength(1);
  });

  it('rejects duplicate types', () => {
    const registry = createFeatureSchemaRegistry();
    registry.register(schema('box', 1));
    expect(() => {
      registry.register(schema('box', 1));
    }).toThrow(/Duplicate feature schema 'box'/);
  });

  it('requires migrate() once version > 1', () => {
    const registry = createFeatureSchemaRegistry();
    expect(() => {
      registry.register(schema('box', 2));
    }).toThrow(/needs migrate/);
    registry.register(schema('box', 2, () => ({})));
    expect(registry.has('box')).toBe(true);
  });

  it('rejects a version that is not a positive integer', () => {
    const registry = createFeatureSchemaRegistry();
    for (const version of [0, -1, 1.5]) {
      expect(() => {
        registry.register(schema('box', version));
      }).toThrow(/invalid version/);
    }
  });
});

describe('isParamVisible (M13)', () => {
  const plain: ParamSpec = { kind: 'length', label: 'L', default: 1 };

  it('is true without a predicate', () => {
    expect(isParamVisible(plain, {})).toBe(true);
  });

  it('follows the predicate over the params', () => {
    const spec: ParamSpec = {
      kind: 'bodies',
      label: 'B',
      visibleWhen: (p) => p.operation !== 'new',
    };
    expect(isParamVisible(spec, { operation: 'add' })).toBe(true);
    expect(isParamVisible(spec, { operation: 'new' })).toBe(false);
  });

  it('passes the params object itself to the predicate', () => {
    const params = { operation: 'new' };
    const seen: unknown[] = [];
    const spec: ParamSpec = {
      ...plain,
      visibleWhen: (p) => {
        seen.push(p);
        return true;
      },
    };
    isParamVisible(spec, params);
    expect(seen).toEqual([params]);
    expect(seen[0]).toBe(params);
  });
});

// M20: the schema of params tied to their type. Compile-time checks: `npm run typecheck` fails
// when an @ts-expect-error is not needed.
describe('ParamSchemaOf', () => {
  interface Params {
    readonly size: number;
    readonly note?: string;
  }
  const spec: ParamSpec = { kind: 'length', label: 'size', default: 1 };

  it('wants exactly one spec per key of the params, optional keys too', () => {
    const exact: ParamSchemaOf<Params> = { size: spec, note: spec };
    // @ts-expect-error the optional key 'note' is missing
    const missing: ParamSchemaOf<Params> = { size: spec };
    // @ts-expect-error 'extra' is no key of the params
    const extra: ParamSchemaOf<Params> = { size: spec, note: spec, extra: spec };
    expect([exact, missing, extra]).toHaveLength(3);
  });

  it('is the untyped ParamSchema without known keys (registries)', () => {
    expectTypeOf<ParamSchemaOf<unknown>>().toEqualTypeOf<ParamSchema>();
    expectTypeOf<FeatureSchema['params']>().toEqualTypeOf<ParamSchema>();
  });

  it('a typed schema passes as an untyped one and its params as ParamSchema', () => {
    expectTypeOf<FeatureSchema<Params>>().toExtend<FeatureSchema>();
    expectTypeOf<ParamSchemaOf<Params>>().toExtend<ParamSchema>();
  });
});
