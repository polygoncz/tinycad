// Ring 1 – Cylinder feature plugin (spec 11, Plugin featury).
// Public API of features/cylinder. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { cylinderMessages } from './messages';
import type { CylinderParams } from './params';
import { cylinderTool } from './tool';

export type { CylinderParams } from './params';

export const cylinderPlugin: FeaturePlugin<CylinderParams> = Object.freeze<
  FeaturePlugin<CylinderParams>
>({
  type: 'cylinder',
  tools: Object.freeze([cylinderTool]),
  messages: cylinderMessages,
});
