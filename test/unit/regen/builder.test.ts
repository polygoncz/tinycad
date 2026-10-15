import { describe, expect, expectTypeOf, it } from 'vitest';
import { bodyId } from '@/document';
import type { Evaluated, FeatureId } from '@/document';
import type { BuildInput, FeatureBuilder, RefError } from '@/regen/builder';
import { createBuilderRegistry, unresolvedReference } from '@/regen/builder';

function aBuilder(type: string): FeatureBuilder {
  return {
    type,
    build: ({ state }) => Promise.resolve({ ok: true, state, anchors: {} }),
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

describe('unresolvedReference', () => {
  // Branded ids are created by a cast in tests.
  const box1 = 'box1' as FeatureId;
  const e: RefError = {
    ref: { kind: 'body', body: bodyId(box1) },
    message: 'Body box1/body not found',
  };

  it('is an UNRESOLVED_REFERENCE with the message of the RefError and an issue at the param', () => {
    expect(unresolvedReference('tools', e)).toEqual({
      code: 'UNRESOLVED_REFERENCE',
      message: 'Body box1/body not found',
      issues: [{ param: 'tools', code: 'param.unresolvedRef' }],
    });
  });

  it('is deeply frozen', () => {
    const error = unresolvedReference('tools', e);
    expect(Object.isFrozen(error)).toBe(true);
    expect(Object.isFrozen(error.issues)).toBe(true);
    for (const issue of error.issues ?? []) expect(Object.isFrozen(issue)).toBe(true);
  });
});

describe('BuildInput', () => {
  interface SizeParams {
    readonly size: number;
  }

  it('carries the evaluated params and the feature without its params', () => {
    expectTypeOf<BuildInput<SizeParams>['params']>().toEqualTypeOf<Evaluated<SizeParams>>();
    expectTypeOf<BuildInput<SizeParams>['feature']>().not.toHaveProperty('params');
    expectTypeOf<BuildInput<SizeParams>['feature']>()
      .toHaveProperty('id')
      .toEqualTypeOf<FeatureId>();
  });
});
