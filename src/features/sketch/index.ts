// Ring 1 – Sketch feature plugin (spec 12, Featura skici).
// Public API of features/sketch. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { sketchMessages } from './messages';

// No tools and no ops: entering the sketcher is the built-in tool sketch of interaction
// (ADR 0017) and editing goes through feature.setParams (Q074). The schema is the core's (N123),
// so the plugin brings only the texts of its translation keys.
export const sketchPlugin: FeaturePlugin = Object.freeze<FeaturePlugin>({
  type: 'sketch',
  messages: sketchMessages,
});
