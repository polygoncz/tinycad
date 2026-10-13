import { describe, expect, it } from 'vitest';
import { createFeatureSchemaRegistry } from '@/document';
import type { FeatureSchema } from '@/document';
import { createBuilderRegistry } from '@/regen';
import type { FeatureBuilder } from '@/regen';
import { aSchema, aSpyBuilder, validateSize } from '@/regen/testing';
import type { FeaturePlugin } from '.';
import { registerPlugin } from '.';

function registries() {
  return { schemas: createFeatureSchemaRegistry(), builders: createBuilderRegistry() };
}

function aPlugin(schemaType = 'box', builderType = schemaType): FeaturePlugin {
  return { schema: aSchema(schemaType), builder: aSpyBuilder(builderType) };
}

describe('registerPlugin', () => {
  it('registers the schema and the builder of the plugin', () => {
    const regs = registries();
    const plugin = aPlugin();
    registerPlugin(plugin, regs);
    expect(regs.schemas.get('box')).toBe(plugin.schema);
    expect(regs.builders.get('box')).toBe(plugin.builder);
  });

  it('accepts a plugin typed with its own params', () => {
    // Compile-time check: FeaturePlugin<P> must be passable without a cast.
    interface SizeParams {
      readonly size: number;
    }
    const schema: FeatureSchema<SizeParams> = {
      type: 'cube',
      version: 1,
      label: 'Cube',
      params: { size: { kind: 'length', label: 'Size', default: 1, min: 0 } },
      defaults: () => ({ size: 1 }),
      validate: validateSize,
    };
    const builder: FeatureBuilder<SizeParams> = {
      type: 'cube',
      build: async ({ state }) => Promise.resolve({ ok: true, state }),
    };
    const plugin: FeaturePlugin<SizeParams> = { schema, builder };
    const regs = registries();
    registerPlugin(plugin, regs);
    expect(regs.schemas.has('cube')).toBe(true);
    expect(regs.builders.has('cube')).toBe(true);
  });

  it('throws on a schema and builder of different types and registers nothing', () => {
    const regs = registries();
    expect(() => {
      registerPlugin(aPlugin('box', 'cylinder'), regs);
    }).toThrow(/box.*cylinder/);
    expect(regs.schemas.all()).toEqual([]);
    expect(regs.builders.all()).toEqual([]);
  });

  it('throws on a type already in the schema registry and registers nothing more', () => {
    const regs = registries();
    const existing = aSchema('box');
    regs.schemas.register(existing);
    expect(() => {
      registerPlugin(aPlugin(), regs);
    }).toThrow(/box/);
    expect(regs.schemas.all()).toEqual([existing]);
    expect(regs.builders.all()).toEqual([]);
  });

  it('throws on a type already in the builder registry and registers nothing more', () => {
    const regs = registries();
    const existing = aSpyBuilder('box');
    regs.builders.register(existing);
    expect(() => {
      registerPlugin(aPlugin(), regs);
    }).toThrow(/box/);
    expect(regs.schemas.all()).toEqual([]);
    expect(regs.builders.all()).toEqual([existing]);
  });

  it('throws when the same plugin is registered twice', () => {
    const regs = registries();
    const plugin = aPlugin();
    registerPlugin(plugin, regs);
    expect(() => {
      registerPlugin(plugin, regs);
    }).toThrow(/box/);
    expect(regs.schemas.all()).toEqual([plugin.schema]);
    expect(regs.builders.all()).toEqual([plugin.builder]);
  });
});
