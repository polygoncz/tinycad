// Ring 1 – Fillet feature plugin (spec 11, Plugin featury; M14).
// Public API of features/fillet. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { filletMessages } from './messages';
import type { FilletParams } from './params';
import { filletTool } from './tool';

export type { FilletParams } from './params';

export const filletPlugin: FeaturePlugin<FilletParams> = Object.freeze<FeaturePlugin<FilletParams>>(
  {
    type: 'fillet',
    tools: Object.freeze([filletTool]),
    messages: filletMessages,
  },
);
