import { describe, expect, expectTypeOf, it } from 'vitest';
import type { FeatureSchema, ParamSchemaOf } from '@/document';
import type { ManipulatorDescriptor } from '@/interaction';
import type { Anchor, BuildOutput, FeatureBuilder } from '@/regen';
import type { FeaturePlugin } from '@/plugin-api';

// Typed anchors (M20, ADR 0021 addendum): the builder and the manipulator descriptor of one
// plugin share the type of its anchors, so a name the builder does not return is a type error.
// Most checks are compile-time: `npm run typecheck` fails when an @ts-expect-error is not needed.

interface SizeParams {
  readonly size: number;
}

/** Anchors of a plugin that returns 'pivot' only sometimes. */
type PivotAnchors = { readonly pivot?: Anchor };

const PARAMS: ParamSchemaOf<SizeParams> = {
  size: { kind: 'length', label: 'cube.size', default: 1 },
};

const SCHEMA: FeatureSchema<SizeParams> = {
  type: 'cube',
  version: 1,
  label: 'cube.label',
  params: PARAMS,
  defaults: () => ({ size: 1 }),
  validate: () => [],
};

const BUILDER: FeatureBuilder<SizeParams, PivotAnchors> = {
  type: 'cube',
  build: async ({ state }) => Promise.resolve({ ok: true, state, anchors: {} }),
};

describe('FeaturePlugin anchors (M20)', () => {
  it('the descriptor reads the anchors the builder returns', () => {
    const plugin: FeaturePlugin<SizeParams, PivotAnchors> = {
      schema: SCHEMA,
      builder: BUILDER,
      manipulators: {
        type: 'cube',
        frame: (_params, anchors) => (anchors.pivot === undefined ? null : null),
      },
    };
    expect(plugin.manipulators?.type).toBe('cube');
  });

  it('a descriptor reading an anchor the builder does not return does not compile', () => {
    const plugin: FeaturePlugin<SizeParams, PivotAnchors> = {
      schema: SCHEMA,
      builder: BUILDER,
      manipulators: {
        type: 'cube',
        // @ts-expect-error 'base' is not an anchor of the plugin
        frame: (_params, anchors) => (anchors.base === undefined ? null : null),
      },
    };
    expect(plugin.builder.type).toBe('cube');
  });

  it('a descriptor of other anchors does not fit the plugin', () => {
    const other: ManipulatorDescriptor<SizeParams, { readonly base?: Anchor }> = {
      type: 'cube',
      frame: () => null,
    };
    const plugin: FeaturePlugin<SizeParams, PivotAnchors> = {
      schema: SCHEMA,
      builder: BUILDER,
      // @ts-expect-error the descriptor wants 'base', the builder returns 'pivot'
      manipulators: other,
    };
    expect(plugin.schema.type).toBe('cube');
  });

  it('a builder returning an anchor outside its type does not compile', () => {
    const builder: FeatureBuilder<SizeParams, PivotAnchors> = {
      type: 'cube',
      build: async ({ state }) =>
        // @ts-expect-error 'base' is not an anchor of the plugin
        Promise.resolve({ ok: true, state, anchors: { base: { point: [0, 0, 0] } } }),
    };
    expect(builder.type).toBe('cube');
  });

  it('anchors are required in a successful build output', () => {
    expectTypeOf<Extract<BuildOutput, { ok: true }>['anchors']>().not.toBeUndefined();
    // @ts-expect-error a builder without a manipulator returns {}
    const output: BuildOutput = { ok: true, state: { artifacts: new Map() } };
    expect(output.ok).toBe(true);
  });

  it('a typed plugin passes where the registries want an untyped one', () => {
    expectTypeOf<FeaturePlugin<SizeParams, PivotAnchors>>().toExtend<FeaturePlugin>();
    expectTypeOf<
      ManipulatorDescriptor<SizeParams, PivotAnchors>
    >().toExtend<ManipulatorDescriptor>();
  });
});
