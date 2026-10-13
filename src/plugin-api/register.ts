import { assert } from '@/core';
import type { FeatureSchemaRegistry } from '@/document';
import type { BuilderRegistry } from '@/regen';
import type { FeaturePlugin } from './plugin';

/**
 * Registers the schema and the builder of the plugin (Q047). Used by app and tests alike, so
 * "every type has a schema and a builder" holds by construction. Mismatched types or a duplicate
 * type are programmer errors: it throws and registers nothing.
 */
export function registerPlugin(
  plugin: FeaturePlugin,
  registries: { readonly schemas: FeatureSchemaRegistry; readonly builders: BuilderRegistry },
): void {
  const { schema, builder } = plugin;
  const { schemas, builders } = registries;
  assert(
    schema.type === builder.type,
    `Plugin schema type '${schema.type}' differs from builder type '${builder.type}'`,
  );
  // Check both registries first, so a duplicate builder does not leave the schema registered.
  assert(!schemas.has(schema.type), `Duplicate feature schema '${schema.type}'`);
  assert(!builders.has(builder.type), `Duplicate feature builder '${builder.type}'`);
  schemas.register(schema);
  builders.register(builder);
}
