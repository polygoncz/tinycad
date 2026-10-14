// Ring 1 – Chamfer feature plugin (spec 11, Plugin featury; M14).
// Public API of features/chamfer. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { chamferBuilder } from './builder';
import { chamferMessages } from './messages';
import { chamferSchema } from './schema';
import type { ChamferParams } from './schema';
import { chamferTool } from './tool';

export type { ChamferParams } from './schema';

export const chamferPlugin: FeaturePlugin<ChamferParams> = Object.freeze<
  FeaturePlugin<ChamferParams>
>({
  schema: chamferSchema,
  builder: chamferBuilder,
  tools: Object.freeze([chamferTool]),
  messages: chamferMessages,
});
