// Ring 1 – Boolean feature plugin (spec 11, Plugin featury).
// Public API of features/boolean. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { booleanBuilder } from './builder';
import { booleanMessages } from './messages';
import { booleanSchema } from './schema';
import type { BooleanParams } from './schema';
import { booleanTool } from './tool';

export type { BooleanParams } from './schema';

export const booleanPlugin: FeaturePlugin<BooleanParams> = Object.freeze<
  FeaturePlugin<BooleanParams>
>({
  schema: booleanSchema,
  builder: booleanBuilder,
  tools: Object.freeze([booleanTool]),
  messages: booleanMessages,
});
