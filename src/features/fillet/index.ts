// Ring 1 – Fillet feature plugin (spec 11, Plugin featury; M14).
// Public API of features/fillet. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { filletBuilder } from './builder';
import { filletMessages } from './messages';
import { filletSchema } from './schema';
import type { FilletParams } from './schema';
import { filletTool } from './tool';

export type { FilletParams } from './schema';

export const filletPlugin: FeaturePlugin<FilletParams> = Object.freeze<FeaturePlugin<FilletParams>>(
  {
    schema: filletSchema,
    builder: filletBuilder,
    tools: Object.freeze([filletTool]),
    messages: filletMessages,
  },
);
