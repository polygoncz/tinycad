// Ring 1 – FeaturePlugin type and its registration.
// Public API of plugin-api (spec 11). Everything else in this folder is internal.

export type { FeaturePlugin, PluginMessages } from './plugin';
export { registerPlugin } from './register';
