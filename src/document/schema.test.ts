import { describe, expect, it } from 'vitest';
import { createFeatureSchemaRegistry } from './schema';
import type { FeatureSchema } from './schema';

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
