import { describe, expect, it } from 'vitest';
import { createFeatureSchemaRegistry } from '@/document';
import { createOpHandlerRegistry } from './handler';
import type { OpHandler } from './handler';

const deps = { schemas: createFeatureSchemaRegistry() };

describe('createOpHandlerRegistry', () => {
  it('contains the seven built-in handlers', () => {
    expect(
      createOpHandlerRegistry(deps)
        .all()
        .map((h) => h.type)
        .sort(),
    ).toEqual(
      [
        'feature.add',
        'feature.remove',
        'feature.setParams',
        'feature.rename',
        'feature.suppress',
        'feature.move',
        'studio.setRollback',
      ].sort(),
    );
  });

  it('has no handler for batch and refuses to register one', () => {
    const registry = createOpHandlerRegistry(deps);
    expect(registry.has('batch')).toBe(false);
    const fake: OpHandler = {
      type: 'batch',
      version: 1,
      invert: () => ({ type: 'batch', v: 1 }),
      apply: () => undefined,
    };
    expect(() => {
      registry.register(fake);
    }).toThrow(/batch/);
  });

  it('accepts new handlers and rejects duplicates', () => {
    const registry = createOpHandlerRegistry(deps);
    const custom: OpHandler = {
      type: 'sketch.noop',
      version: 1,
      invert: () => ({ type: 'sketch.noop', v: 1 }),
      apply: () => undefined,
    };
    registry.register(custom);
    expect(registry.get('sketch.noop')).toBe(custom);
    expect(() => {
      registry.register(custom);
    }).toThrow();
    expect(() => {
      registry.register(registry.get('feature.add'));
    }).toThrow();
  });

  it('registries are independent', () => {
    expect(createOpHandlerRegistry(deps)).not.toBe(createOpHandlerRegistry(deps));
  });
});
