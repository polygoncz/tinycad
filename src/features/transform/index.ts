// Ring 1 – Transform feature plugin (spec 11, Plugin featury).
// Public API of features/transform. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { transformBuilder } from './builder';
import type { TransformAnchors } from './builder';
import { transformManipulators } from './manipulators';
import { transformMessages } from './messages';
import { transformSchema } from './schema';
import type { TransformParams } from './schema';
import { transformTool } from './tool';

export type { TransformParams } from './schema';
export type { TransformAnchors } from './builder';

export const transformPlugin: FeaturePlugin<TransformParams, TransformAnchors> = Object.freeze<
  FeaturePlugin<TransformParams, TransformAnchors>
>({
  schema: transformSchema,
  builder: transformBuilder,
  tools: Object.freeze([transformTool]),
  messages: transformMessages,
  manipulators: transformManipulators,
});
