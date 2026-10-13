// Ring 1 – Box feature plugin (spec 11, Plugin featury).
// Public API of features/box. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { boxBuilder } from './builder';
import { boxSchema } from './schema';
import type { BoxParams } from './schema';
import { boxTool } from './tool';

export type { BoxParams } from './schema';

export const boxPlugin: FeaturePlugin<BoxParams> = Object.freeze<FeaturePlugin<BoxParams>>({
  schema: boxSchema,
  builder: boxBuilder,
  tools: Object.freeze([boxTool]),
});
