import { assert } from '@/core';
import type { FeatureSchemaRegistry } from '@/document';
import type { ToolDescriptor, ToolRegistry } from '@/interaction';
import type { BuilderRegistry } from '@/regen';
import type { FeaturePlugin } from './plugin';

/**
 * Registers the schema, the builder and the tools of the plugin (Q047). Used by app and tests
 * alike, so "every type has a schema and a builder" holds by construction. Mismatched types or a
 * duplicate type or tool id are programmer errors: it throws and registers nothing.
 */
export function registerPlugin(
  plugin: FeaturePlugin,
  registries: {
    readonly schemas: FeatureSchemaRegistry;
    readonly builders: BuilderRegistry;
    readonly tools: ToolRegistry;
  },
): void {
  const { schema, builder } = plugin;
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
  schemas.register(schema);
  builders.register(builder);
  for (const tool of tools) registries.tools.register(tool);
}

/** Tool ids must be unique within the plugin and not yet in the registry. */
function checkToolIds(tools: readonly ToolDescriptor[], registry: ToolRegistry): void {
  const seen = new Set<string>();
  for (const { id } of tools) {
    assert(!seen.has(id) && !registry.has(id), `Duplicate tool '${id}'`);
    seen.add(id);
  }
}
