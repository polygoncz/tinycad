import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Anchor, ManipulatorDescriptor } from '@/interaction';
import type { FeaturePlugin } from '@/plugin-api';

// Typed anchors (M20, ADR 0021 addendum): the manipulator descriptor of a plugin reads the anchors
// of its type, so a name outside the type is a type error. Most checks are compile-time:
// `npm run typecheck` fails when an @ts-expect-error is not needed.

interface SizeParams {
  readonly size: number;
}

/** Anchors of a plugin that has 'pivot' only sometimes. */
type PivotAnchors = { readonly pivot?: Anchor };

describe('FeaturePlugin anchors (M20)', () => {
  it('the descriptor reads the anchors of the plugin', () => {
    const plugin: FeaturePlugin<SizeParams, PivotAnchors> = {
      type: 'cube',
      manipulators: {
        type: 'cube',
        frame: (_params, anchors) => (anchors.pivot === undefined ? null : null),
      },
    };
    expect(plugin.manipulators?.type).toBe('cube');
  });

  it('a descriptor reading an anchor outside the type does not compile', () => {
    const plugin: FeaturePlugin<SizeParams, PivotAnchors> = {
      type: 'cube',
      manipulators: {
        type: 'cube',
        // @ts-expect-error 'base' is not an anchor of the plugin
        frame: (_params, anchors) => (anchors.base === undefined ? null : null),
      },
    };
    expect(plugin.type).toBe('cube');
  });

  it('a descriptor of other anchors does not fit the plugin', () => {
    const other: ManipulatorDescriptor<SizeParams, { readonly base?: Anchor }> = {
      type: 'cube',
      frame: () => null,
    };
    const plugin: FeaturePlugin<SizeParams, PivotAnchors> = {
      type: 'cube',
      // @ts-expect-error the descriptor wants 'base', the plugin has 'pivot'
      manipulators: other,
    };
    expect(plugin.type).toBe('cube');
  });

  it('a typed plugin passes where the registries want an untyped one', () => {
    expectTypeOf<FeaturePlugin<SizeParams, PivotAnchors>>().toExtend<FeaturePlugin>();
    expectTypeOf<
      ManipulatorDescriptor<SizeParams, PivotAnchors>
    >().toExtend<ManipulatorDescriptor>();
  });
});
