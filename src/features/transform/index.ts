// Ring 1 – Transform feature plugin (spec 11, Plugin featury).
// Public API of features/transform. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { transformBuilder } from './builder';
import { transformManipulators } from './manipulators';
import { transformMessages } from './messages';
import { transformSchema } from './schema';
import type { TransformParams } from './schema';
import { transformTool } from './tool';

export type { TransformParams } from './schema';

export const transformPlugin: FeaturePlugin<TransformParams> = Object.freeze<
  FeaturePlugin<TransformParams>
>({
  schema: transformSchema,
  builder: transformBuilder,
  tools: Object.freeze([transformTool]),
  messages: transformMessages,
  manipulators: transformManipulators,
});
