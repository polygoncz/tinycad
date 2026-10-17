// Ring 1 – Chamfer feature plugin (spec 11, Plugin featury; M14).
// Public API of features/chamfer. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { chamferMessages } from './messages';
import type { ChamferParams } from './params';
import { chamferTool } from './tool';

export type { ChamferParams } from './params';

export const chamferPlugin: FeaturePlugin<ChamferParams> = Object.freeze<
  FeaturePlugin<ChamferParams>
>({
  type: 'chamfer',
  tools: Object.freeze([chamferTool]),
  messages: chamferMessages,
});
