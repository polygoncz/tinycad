import type { FeatureAnchors, ManipulatorDescriptor, ToolDescriptor } from '@/interaction';

/**
 * Unit of extensibility (spec 11): the client half of a feature type. The schema and the builder
 * are the core's (N67, N123); the plugin gives only what the server cannot – the tools, the
 * manipulator descriptor and the texts of its translation keys. A is the type of the anchors the
 * core computes and the manipulator descriptor reads (M20, ADR 0021).
 */
export interface FeaturePlugin<P = unknown, A extends FeatureAnchors = FeatureAnchors> {
  /** The feature type of the core this plugin belongs to. */
  readonly type: string;
  /** Goes to ToolRegistry (interaction). */
  readonly tools?: readonly ToolDescriptor[];
  /** Texts of the plugin's translation keys (schema labels, own issue codes); ui adds them to vue-i18n (ADR 0014). */
  readonly messages?: PluginMessages;
  /** Goes to ManipulatorRegistry (interaction); its type is the feature type (M18). */
  readonly manipulators?: ManipulatorDescriptor<P, A>;
}

/** One dictionary per language: translation key → text. */
export type PluginMessages = {
  readonly cs: Readonly<Record<string, string>>;
  readonly en: Readonly<Record<string, string>>;
};
