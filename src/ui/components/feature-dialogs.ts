// The escape hatch for an own feature dialog (spec 11, "Vlastní dialog featury"; R80). The
// generated FeatureDialog serves every feature up to M15; a feature that outgrows it gets its own
// component here, in ui – the plugin is ring 1 and knows no Vue. An own dialog has the same
// interface as FeatureDialog (prop `edit: FeatureEditSession`, nothing else) and the same rules:
// state only through useObservable, changes only through the session, logic in interaction.
// Prefer a new kind of param field (params/registry.ts): it serves every feature.
import type { Component } from 'vue';
import FeatureDialog from './FeatureDialog.vue';

/** featureType → dialog component; empty in M13. */
export const FEATURE_DIALOGS: Readonly<Record<string, Component>> = Object.freeze({});

/**
 * The dialog of a feature type: its own component, otherwise the generated FeatureDialog.
 * `dialogs` is there for the test only (FEATURE_DIALOGS is empty).
 */
export function dialogFor(
  featureType: string,
  dialogs: Readonly<Record<string, Component>> = FEATURE_DIALOGS,
): Component {
  // Own keys only: 'constructor' is not a feature type with a dialog.
  return (Object.hasOwn(dialogs, featureType) ? dialogs[featureType] : undefined) ?? FeatureDialog;
}
