import { describe, expect, it } from 'vitest';
import { createFeatureSchemaRegistry, isParamVisible } from './schema';
import type { FeatureSchema, ParamSpec } from './schema';

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
