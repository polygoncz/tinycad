import { describe, expect, it } from 'vitest';
import { createFeatureSchemaRegistry } from '@/document';
import type { FeatureSchema } from '@/document';
import { createManipulatorRegistry, createToolRegistry } from '@/interaction';
import type { ManipulatorDescriptor, Tool, ToolDescriptor } from '@/interaction';
import { createBuilderRegistry } from '@/regen';
import type { FeatureBuilder } from '@/regen';
import { aSchema, aSpyBuilder, validateSize } from '@/regen/testing';
import type { FeaturePlugin, PluginMessages } from '.';
import { registerPlugin } from '.';

function registries() {
  return {
    schemas: createFeatureSchemaRegistry(),
    builders: createBuilderRegistry(),
    tools: createToolRegistry(),
    manipulators: createManipulatorRegistry(),
  };
}

function aPlugin(schemaType = 'box', builderType = schemaType): FeaturePlugin {
  return { schema: aSchema(schemaType), builder: aSpyBuilder(builderType) };
}

/** A descriptor that is never activated here: registration only stores it. */
function aTool(id: string): ToolDescriptor {
  return {
    id,
    label: id,
    icon: id,
    group: 'primitive',
    create(): Tool {
      throw new Error('Tool.create is not expected in registration tests');
    },
  };
}

/** A descriptor that is never asked for handles here: registration only stores it. */
function aManipulator(type: string): ManipulatorDescriptor {
  return {
    type,
    handles() {
      throw new Error('ManipulatorDescriptor.handles is not expected in registration tests');
    },
  };
}

function aPluginWithManipulator(type: string, manipulatorType = type): FeaturePlugin {
  return { ...aPlugin(type), manipulators: aManipulator(manipulatorType) };
}

function aPluginWithTools(type: string, toolIds: readonly string[]): FeaturePlugin {
  return { ...aPlugin(type), tools: toolIds.map(aTool) };
}

describe('registerPlugin', () => {
  it('registers the schema and the builder of the plugin', () => {
    const regs = registries();
    const plugin = aPlugin();
    registerPlugin(plugin, regs);
    expect(regs.schemas.get('box')).toBe(plugin.schema);
    expect(regs.builders.get('box')).toBe(plugin.builder);
  });

  it('accepts a plugin typed with its own params and its messages', () => {
    // Compile-time check: FeaturePlugin<P> must be passable without a cast. The messages
    // are for ui (ADR 0014); registration leaves them alone.
    interface SizeParams {
      readonly size: number;
    }
    const schema: FeatureSchema<SizeParams> = {
      type: 'cube',
      version: 1,
      label: 'cube.label',
      params: {
        size: { kind: 'length', label: 'cube.size', default: 1, min: 0, exclusiveMin: true },
      },
      defaults: () => ({ size: 1 }),
      validate: validateSize,
    };
    const builder: FeatureBuilder<SizeParams> = {
      type: 'cube',
      build: async ({ state }) => Promise.resolve({ ok: true, state }),
    };
    const messages: PluginMessages = {
      cs: { 'cube.label': 'Krychle', 'cube.size': 'Velikost' },
      en: { 'cube.label': 'Cube', 'cube.size': 'Size' },
    };
    const plugin: FeaturePlugin<SizeParams> = { schema, builder, messages };
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

  it('registers the tools of the plugin in their order', () => {
    const regs = registries();
    const plugin = aPluginWithTools('box', ['box', 'box-drag']);
    registerPlugin(plugin, regs);
    expect(regs.tools.all()).toEqual(plugin.tools);
  });

  it('registers no tool for a plugin without tools', () => {
    const regs = registries();
    registerPlugin(aPlugin(), regs);
    expect(regs.tools.all()).toEqual([]);
  });

  it('throws on a duplicate tool id within the plugin and registers nothing', () => {
    const regs = registries();
    expect(() => {
      registerPlugin(aPluginWithTools('box', ['box', 'other', 'box']), regs);
    }).toThrow(/box/);
    expect(regs.schemas.all()).toEqual([]);
    expect(regs.builders.all()).toEqual([]);
    expect(regs.tools.all()).toEqual([]);
  });

  it('throws on a tool id already in the tool registry and registers nothing more', () => {
    const regs = registries();
    const existing = aTool('box');
    regs.tools.register(existing);
    expect(() => {
      registerPlugin(aPluginWithTools('cube', ['cube', 'box']), regs);
    }).toThrow(/box/);
    expect(regs.schemas.all()).toEqual([]);
    expect(regs.builders.all()).toEqual([]);
    expect(regs.tools.all()).toEqual([existing]);
  });

  it('registers no tool when the schema or builder type is a duplicate', () => {
    const regs = registries();
    regs.schemas.register(aSchema('box'));
    expect(() => {
      registerPlugin(aPluginWithTools('box', ['box']), regs);
    }).toThrow(/box/);
    expect(regs.tools.all()).toEqual([]);
  });

  it('registers the manipulator descriptor of the plugin under its type', () => {
    const regs = registries();
    const plugin = aPluginWithManipulator('box');
    registerPlugin(plugin, regs);
    expect(regs.manipulators.get('box')).toBe(plugin.manipulators);
  });

  it('leaves the manipulator registry alone for a plugin without a descriptor', () => {
    const regs = registries();
    registerPlugin(aPlugin(), regs);
    expect(regs.manipulators.all()).toEqual([]);
  });

  it('throws on a descriptor type other than the schema type and registers nothing', () => {
    const regs = registries();
    expect(() => {
      registerPlugin(
        { ...aPluginWithTools('box', ['box']), manipulators: aManipulator('cube') },
        regs,
      );
    }).toThrow(/box.*cube|cube.*box/);
    expect(regs.schemas.all()).toEqual([]);
    expect(regs.builders.all()).toEqual([]);
    expect(regs.tools.all()).toEqual([]);
    expect(regs.manipulators.all()).toEqual([]);
  });

  it('throws on a type already in the manipulator registry and registers nothing more', () => {
    const regs = registries();
    const existing = aManipulator('box');
    regs.manipulators.register(existing);
    expect(() => {
      registerPlugin(
        { ...aPluginWithTools('box', ['box']), manipulators: aManipulator('box') },
        regs,
      );
    }).toThrow("Duplicate manipulator 'box'");
    expect(regs.schemas.all()).toEqual([]);
    expect(regs.builders.all()).toEqual([]);
    expect(regs.tools.all()).toEqual([]);
    expect(regs.manipulators.all()).toEqual([existing]);
  });

  it('accepts a plugin with a manipulator descriptor typed with its own params', () => {
    // Compile-time check: handles is a method, so FeaturePlugin<P> with ManipulatorDescriptor<P>
    // must be passable as FeaturePlugin without a cast (spec 10, "Deskriptor a úchyty").
    interface SizeParams {
      readonly size: number;
    }
    const plugin: FeaturePlugin<SizeParams> = {
      schema: {
        type: 'cube',
        version: 1,
        label: 'cube.label',
        params: {
          size: { kind: 'length', label: 'cube.size', default: 1, min: 0, exclusiveMin: true },
        },
        defaults: () => ({ size: 1 }),
        validate: validateSize,
      },
      builder: { type: 'cube', build: async ({ state }) => Promise.resolve({ ok: true, state }) },
      manipulators: {
        type: 'cube',
        handles: (params) => [
          {
            kind: 'linear',
            id: 'size',
            value: params.size,
            unit: 'length',
            tint: 'neutral',
            position: [0, 0, 0],
            direction: [0, 0, 1],
            toParams: (size) => ({ size }),
          },
        ],
      },
    };
    const regs = registries();
    registerPlugin(plugin, regs);
    expect(regs.manipulators.get('cube')).toBe(plugin.manipulators);
  });
});
