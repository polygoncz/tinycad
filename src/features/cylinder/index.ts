// Ring 1 – Cylinder feature plugin (spec 11, Plugin featury).
// Public API of features/cylinder. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { cylinderBuilder } from './builder';
import { cylinderMessages } from './messages';
import { cylinderSchema } from './schema';
import type { CylinderParams } from './schema';
import { cylinderTool } from './tool';

export type { CylinderParams } from './schema';

export const cylinderPlugin: FeaturePlugin<CylinderParams> = Object.freeze<
  FeaturePlugin<CylinderParams>
>({
  schema: cylinderSchema,
  builder: cylinderBuilder,
  tools: Object.freeze([cylinderTool]),
  messages: cylinderMessages,
});
