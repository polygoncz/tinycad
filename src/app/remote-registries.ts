// The registries of a session over the core (N67, Q098): the schemas come from the feature types
// the server describes (featureSchemaOf), the plugins of the client give only what the server
// cannot – tools, manipulators and the texts of their translation keys. A plugin of a type the
// server does not know is skipped with a warning (an older server, a plugin under development).

import { createFeatureSchemaRegistry } from '@/document';
import type { FeatureSchema, FeatureSchemaRegistry } from '@/document';
import { createManipulatorRegistry, createToolRegistry, SELECT_TOOL } from '@/interaction';
import type { ManipulatorRegistry, ToolRegistry } from '@/interaction';
import type { FeaturePlugin, PluginMessages } from '@/plugin-api';

/** The registries of a session; no builders, the server regenerates. */
export interface RemoteRegistries {
  /** One schema per feature type of the server, in its order. */
  readonly schemas: FeatureSchemaRegistry;
  /** The select tool first, then the tools of the plugins the server knows. */
  readonly tools: ToolRegistry;
  /** Manipulator descriptors of the plugins the server knows, by feature type. */
  readonly manipulators: ManipulatorRegistry;
  /** Dictionaries of the plugins the server knows, for vue-i18n (ADR 0014). */
  readonly messages: PluginMessages;
}

/**
 * Registers the schemas of `featureTypes` and the client halves of `plugins`. Throws when two
 * schemas share a type, two tools an id, or two plugins define the same message key.
 */
export function createRemoteRegistries(
  featureTypes: readonly FeatureSchema[],
  plugins: readonly FeaturePlugin[],
): RemoteRegistries {
  const schemas = createFeatureSchemaRegistry();
  for (const schema of featureTypes) schemas.register(migratedByCore(schema));
  const tools = createToolRegistry();
  tools.register(SELECT_TOOL);
  const manipulators = createManipulatorRegistry();
  const known: FeaturePlugin[] = [];
  for (const plugin of plugins) {
    const { type } = plugin;
    if (!schemas.has(type)) {
      console.warn(`The core does not know the feature type '${type}'; its plugin is skipped`);
      continue;
    }
    known.push(plugin);
    for (const tool of plugin.tools ?? []) tools.register(tool);
    if (plugin.manipulators !== undefined) manipulators.register(plugin.manipulators);
  }
  return { schemas, tools, manipulators, messages: mergeMessages(known) };
}

/**
 * The registry of document asks every schema above version 1 for migrate; the descriptors of the
 * core have none, because the core migrates the features before the client sees them (N67). Such
 * a schema gets a migrate that only fails, so a call would show the broken assumption.
 */
function migratedByCore(schema: FeatureSchema): FeatureSchema {
  if (schema.version === 1 || schema.migrate !== undefined) return schema;
  return Object.freeze({
    ...schema,
    migrate(fromVersion: number): never {
      throw new Error(
        `Feature '${schema.type}' version ${String(fromVersion)} reached the client; the core migrates features`,
      );
    },
  });
}

/** One dictionary per language over the plugins; a key defined twice is a programmer error. */
function mergeMessages(plugins: readonly FeaturePlugin[]): PluginMessages {
  const cs: Record<string, string> = {};
  const en: Record<string, string> = {};
  for (const plugin of plugins) {
    if (plugin.messages === undefined) continue;
    addMessages(cs, plugin.messages.cs, plugin.type);
    addMessages(en, plugin.messages.en, plugin.type);
  }
  return Object.freeze({ cs: Object.freeze(cs), en: Object.freeze(en) });
}

function addMessages(
  into: Record<string, string>,
  from: Readonly<Record<string, string>>,
  type: string,
): void {
  for (const [key, text] of Object.entries(from)) {
    if (Object.hasOwn(into, key)) {
      throw new Error(`Duplicate message '${key}' in the plugin '${type}'`);
    }
    into[key] = text;
  }
}
