// Ring 1 – Box feature plugin (spec 11, Plugin featury).
// Public API of features/box. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { boxMessages } from './messages';
import type { BoxParams } from './params';
import { boxTool } from './tool';

export type { BoxParams } from './params';

export const boxPlugin: FeaturePlugin<BoxParams> = Object.freeze<FeaturePlugin<BoxParams>>({
  type: 'box',
  tools: Object.freeze([boxTool]),
  messages: boxMessages,
});
