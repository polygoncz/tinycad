// The registries of a session over the core (N67, Q098): the schemas come from the feature types
// the server describes (featureSchemaOf), the plugins of the client give only what the server
// cannot – tools, manipulators and the texts of their translation keys. A plugin of a type the
// server does not know is skipped with a warning (an older server, a plugin under development).
// The handlers of the operations run over these schemas on the optimistic mirror (N63).

import { createFeatureSchemaRegistry } from '@/document';
import type { FeatureSchema, FeatureSchemaRegistry } from '@/document';
import { createManipulatorRegistry, createToolRegistry, SELECT_TOOL } from '@/interaction';
import type { ManipulatorRegistry, ToolRegistry } from '@/interaction';
import { createOpHandlerRegistry } from '@/ops';
import type { OpHandlerRegistry } from '@/ops';
import type { FeaturePlugin, PluginMessages } from '@/plugin-api';

/** The registries of PluginRegistries without the builders: the server regenerates. */
export interface RemoteRegistries {
  /** One schema per feature type of the server, in its order. */
  readonly schemas: FeatureSchemaRegistry;
  /** The select tool first, then the tools of the plugins the server knows. */
  readonly tools: ToolRegistry;
  /** Manipulator descriptors of the plugins the server knows, by feature type. */
  readonly manipulators: ManipulatorRegistry;
  /** The built-in handlers of operations over `schemas`, for the mirror. */
  readonly handlers: OpHandlerRegistry;
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
  for (const schema of featureTypes) schemas.register(schema);
  const tools = createToolRegistry();
  tools.register(SELECT_TOOL);
  const manipulators = createManipulatorRegistry();
  const known: FeaturePlugin[] = [];
  for (const plugin of plugins) {
    const { type } = plugin.schema;
    if (!schemas.has(type)) {
      console.warn(`The core does not know the feature type '${type}'; its plugin is skipped`);
      continue;
    }
    known.push(plugin);
    for (const tool of plugin.tools ?? []) tools.register(tool);
    if (plugin.manipulators !== undefined) manipulators.register(plugin.manipulators);
  }
  const handlers = createOpHandlerRegistry({ schemas });
  return { schemas, tools, manipulators, handlers, messages: mergeMessages(known) };
}

/** One dictionary per language over the plugins; a key defined twice is a programmer error. */
function mergeMessages(plugins: readonly FeaturePlugin[]): PluginMessages {
  const cs: Record<string, string> = {};
  const en: Record<string, string> = {};
  for (const plugin of plugins) {
    if (plugin.messages === undefined) continue;
    addMessages(cs, plugin.messages.cs, plugin.schema.type);
    addMessages(en, plugin.messages.en, plugin.schema.type);
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
