// The registries of the plugins (spec 11, "Co createAppSession dělá", step 1): what a session
// builds before it opens anything, and what importing a document file needs to check the file
// (spec 11, "Import"). One place, so the import checks against the same registries as a session.

import { createFeatureSchemaRegistry } from '@/document';
import type { FeatureSchemaRegistry } from '@/document';
import { createToolRegistry, SELECT_TOOL } from '@/interaction';
import type { ToolRegistry } from '@/interaction';
import { createOpHandlerRegistry } from '@/ops';
import type { OpHandlerRegistry } from '@/ops';
import { registerPlugin } from '@/plugin-api';
import type { FeaturePlugin, PluginMessages } from '@/plugin-api';
import { createBuilderRegistry } from '@/regen';
import type { BuilderRegistry } from '@/regen';

export interface PluginRegistries {
  readonly schemas: FeatureSchemaRegistry;
  readonly builders: BuilderRegistry;
  /** The select tool first, then the tools of the plugins; a session adds the sketch tools. */
  readonly tools: ToolRegistry;
  /** The built-in handlers of operations over `schemas`. */
  readonly handlers: OpHandlerRegistry;
  /** Dictionaries of the plugins for vue-i18n (ADR 0014). */
  readonly messages: PluginMessages;
}

/**
 * Registers the plugins (registerPlugin) and the built-in handlers of operations. Throws when a
 * plugin is broken, the registries are incomplete or two plugins define the same message key.
 */
export function createPluginRegistries(plugins: readonly FeaturePlugin[]): PluginRegistries {
  const schemas = createFeatureSchemaRegistry();
  const builders = createBuilderRegistry();
  const tools = createToolRegistry();
  tools.register(SELECT_TOOL);
  for (const plugin of plugins) {
    registerPlugin(plugin, { schemas, builders, tools });
  }
  checkComplete(schemas, builders);
  const messages = mergeMessages(plugins);
  const handlers = createOpHandlerRegistry({ schemas });
  return { schemas, builders, tools, handlers, messages };
}

/** Every type has a schema and a builder; registerPlugin guarantees it, this guards app. */
function checkComplete(schemas: FeatureSchemaRegistry, builders: BuilderRegistry): void {
  const schemaTypes = schemas.all().map((s) => s.type);
  const builderTypes = builders.all().map((b) => b.type);
  const missing = [
    ...schemaTypes.filter((t) => !builders.has(t)).map((t) => `builder of '${t}'`),
    ...builderTypes.filter((t) => !schemas.has(t)).map((t) => `schema of '${t}'`),
  ];
  if (missing.length > 0) throw new Error(`Incomplete registries: missing ${missing.join(', ')}`);
}

/** One dictionary per language over all plugins; a key defined twice is a programmer error. */
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
