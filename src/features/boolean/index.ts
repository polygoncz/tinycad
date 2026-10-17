// Ring 1 – Boolean feature plugin (spec 11, Plugin featury).
// Public API of features/boolean. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { booleanMessages } from './messages';
import type { BooleanParams } from './params';
import { booleanTool } from './tool';

export type { BooleanParams } from './params';

export const booleanPlugin: FeaturePlugin<BooleanParams> = Object.freeze<
  FeaturePlugin<BooleanParams>
>({
  type: 'boolean',
  tools: Object.freeze([booleanTool]),
  messages: booleanMessages,
});
