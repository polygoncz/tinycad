import type { FeatureSchema } from '@/document';
import type { ManipulatorDescriptor, ToolDescriptor } from '@/interaction';
import type { FeatureAnchors, FeatureBuilder } from '@/regen';

/**
 * Unit of extensibility (spec 11): each layer has its own registry and knows only its part.
 * Fields grow with milestones: M6 has schema and builder, M9 adds tools, M10 adds messages,
 * (no plugin ops in M12, R36), M18 adds manipulators. M20: A is the type of the anchors; the
 * builder returns them and the manipulator descriptor reads them, so both share it (ADR 0021).
 */
export interface FeaturePlugin<P = unknown, A extends FeatureAnchors = FeatureAnchors> {
  /** Goes to FeatureSchemaRegistry (document). */
  readonly schema: FeatureSchema<P>;
  /** Goes to BuilderRegistry (regen). */
  readonly builder: FeatureBuilder<P, A>;
  /** Goes to ToolRegistry (interaction). */
  readonly tools?: readonly ToolDescriptor[];
  /** Texts of the plugin's translation keys (schema labels, own issue codes); ui adds them to vue-i18n (ADR 0014). */
  readonly messages?: PluginMessages;
  /** Goes to ManipulatorRegistry (interaction); its type is the schema type (M18). */
  readonly manipulators?: ManipulatorDescriptor<P, A>;
}

/** One dictionary per language: translation key → text. */
export type PluginMessages = {
  readonly cs: Readonly<Record<string, string>>;
  readonly en: Readonly<Record<string, string>>;
};
