// The built-in feature plugins of the shared-case runners and the registries made of them, in one
// place: a new built-in feature is added here once and every runner (and the coverage metatest)
// sees it. The plugins directly from @/features/<name>: app (BUILT_IN_PLUGINS) needs the DOM types.

import { createFeatureSchemaRegistry } from '@/document';
import type { FeatureSchemaRegistry } from '@/document';
import { booleanPlugin } from '@/features/boolean';
import { boxPlugin } from '@/features/box';
import { chamferPlugin } from '@/features/chamfer';
import { cylinderPlugin } from '@/features/cylinder';
import { extrudePlugin } from '@/features/extrude';
import { filletPlugin } from '@/features/fillet';
import { revolvePlugin } from '@/features/revolve';
import { sketchPlugin } from '@/features/sketch';
import { transformPlugin } from '@/features/transform';
import { createManipulatorRegistry, createToolRegistry } from '@/interaction';
import type { FeaturePlugin } from '@/plugin-api';
import { registerPlugin } from '@/plugin-api';
import { createBuilderRegistry } from '@/regen';
import type { BuilderRegistry } from '@/regen';

/** Every built-in feature plugin (the nine of spec 13, regen). */
export const BUILT_IN_FEATURE_PLUGINS: readonly FeaturePlugin[] = [
  boxPlugin,
  cylinderPlugin,
  booleanPlugin,
  sketchPlugin,
  extrudePlugin,
  revolvePlugin,
  filletPlugin,
  chamferPlugin,
  transformPlugin,
];

/** A schema registry with the schemas of all built-in plugins. */
export function builtInSchemas(): FeatureSchemaRegistry {
  const schemas = createFeatureSchemaRegistry();
  for (const plugin of BUILT_IN_FEATURE_PLUGINS) schemas.register(plugin.schema);
  return schemas;
}

/** The schema and builder registries of all built-in plugins, as the Regenerator takes them. */
export function builtInRegistries(): {
  readonly schemas: FeatureSchemaRegistry;
  readonly builders: BuilderRegistry;
} {
  const schemas = createFeatureSchemaRegistry();
  const builders = createBuilderRegistry();
  // registerPlugin also wants the UI registries; the runners do not use them.
  const tools = createToolRegistry();
  const manipulators = createManipulatorRegistry();
  for (const plugin of BUILT_IN_FEATURE_PLUGINS) {
    registerPlugin(plugin, { schemas, builders, tools, manipulators });
  }
  return { schemas, builders };
}
