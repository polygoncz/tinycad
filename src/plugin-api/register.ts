import { assert } from '@/core';
import type { FeatureSchemaRegistry } from '@/document';
import type { ManipulatorRegistry, ToolDescriptor, ToolRegistry } from '@/interaction';
import type { BuilderRegistry } from '@/regen';
import type { FeaturePlugin } from './plugin';

/**
 * Registers the schema, the builder, the tools and the manipulator descriptor of the plugin (Q047).
 * Used by app and tests alike, so "every type has a schema and a builder" holds by construction.
 * Mismatched types or a duplicate type or tool id are programmer errors: it throws and registers
 * nothing.
 */
export function registerPlugin(
  plugin: FeaturePlugin,
  registries: {
    readonly schemas: FeatureSchemaRegistry;
    readonly builders: BuilderRegistry;
    readonly tools: ToolRegistry;
    readonly manipulators: ManipulatorRegistry;
  },
): void {
  const { schema, builder, manipulators } = plugin;
  const tools = plugin.tools ?? [];
  const { schemas, builders } = registries;
  assert(
    schema.type === builder.type,
    `Plugin schema type '${schema.type}' differs from builder type '${builder.type}'`,
  );
  // Check every registry first, so a later duplicate does not leave anything registered.
  assert(!schemas.has(schema.type), `Duplicate feature schema '${schema.type}'`);
  assert(!builders.has(builder.type), `Duplicate feature builder '${builder.type}'`);
  checkToolIds(tools, registries.tools);
  if (manipulators !== undefined) {
    assert(
      manipulators.type === schema.type,
      `Plugin schema type '${schema.type}' differs from manipulator type '${manipulators.type}'`,
    );
    assert(
      !registries.manipulators.has(manipulators.type),
      `Duplicate manipulator '${manipulators.type}'`,
    );
  }
  schemas.register(schema);
  builders.register(builder);
  for (const tool of tools) registries.tools.register(tool);
  if (manipulators !== undefined) registries.manipulators.register(manipulators);
}

/** Tool ids must be unique within the plugin and not yet in the registry. */
function checkToolIds(tools: readonly ToolDescriptor[], registry: ToolRegistry): void {
  const seen = new Set<string>();
  for (const { id } of tools) {
    assert(!seen.has(id) && !registry.has(id), `Duplicate tool '${id}'`);
    seen.add(id);
  }
}
