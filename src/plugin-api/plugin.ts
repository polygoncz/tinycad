import type { FeatureSchema } from '@/document';
import type { ToolDescriptor } from '@/interaction';
import type { FeatureBuilder } from '@/regen';

/**
 * Unit of extensibility (spec 11): each layer has its own registry and knows only its part.
 * Fields grow with milestones: M6 has schema and builder, M9 adds tools, M10 adds messages,
 * (no plugin ops in M12, R36).
 */
export interface FeaturePlugin<P = unknown> {
  /** Goes to FeatureSchemaRegistry (document). */
  readonly schema: FeatureSchema<P>;
  /** Goes to BuilderRegistry (regen). */
  readonly builder: FeatureBuilder<P>;
  /** Goes to ToolRegistry (interaction). */
  readonly tools?: readonly ToolDescriptor[];
  /** Texts of the plugin's translation keys (schema labels, own issue codes); ui adds them to vue-i18n (ADR 0014). */
  readonly messages?: PluginMessages;
}

/** One dictionary per language: translation key → text. */
export type PluginMessages = {
  readonly cs: Readonly<Record<string, string>>;
  readonly en: Readonly<Record<string, string>>;
};
