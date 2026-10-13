import { describe, expect, it } from 'vitest';
import type { FeatureBuilder } from './builder';
import { createBuilderRegistry } from './builder';

function aBuilder(type: string): FeatureBuilder {
  return {
    type,
    build: ({ state }) => Promise.resolve({ ok: true, state }),
  };
}

describe('createBuilderRegistry', () => {
  it('finds a builder by its type', () => {
    const builders = createBuilderRegistry();
    const box = aBuilder('box');
    builders.register(box);
    expect(builders.find('box')).toBe(box);
  });

  it('throws on a duplicate type', () => {
    const builders = createBuilderRegistry();
    builders.register(aBuilder('box'));
    expect(() => {
      builders.register(aBuilder('box'));
    }).toThrow(/box/);
  });

  it('returns undefined for an unknown type', () => {
    expect(createBuilderRegistry().find('cylinder')).toBeUndefined();
  });

  it('gives each call its own registry', () => {
    const a = createBuilderRegistry();
    a.register(aBuilder('box'));
    expect(createBuilderRegistry().has('box')).toBe(false);
  });
});
