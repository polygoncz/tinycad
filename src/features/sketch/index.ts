// Ring 1 – Sketch feature plugin (spec 12, Featura skici).
// Public API of features/sketch. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { sketchBuilder } from './builder';
import { sketchMessages } from './messages';
import { sketchSchema } from './schema';
import type { SketchParams } from './schema';

export type { SketchParams } from './schema';

// No tools and no ops: entering the sketcher is the built-in tool sketch of interaction
// (ADR 0017) and editing goes through feature.setParams (Q074).
export const sketchPlugin: FeaturePlugin<SketchParams> = Object.freeze<FeaturePlugin<SketchParams>>(
  {
    schema: sketchSchema,
    builder: sketchBuilder,
    messages: sketchMessages,
  },
);
