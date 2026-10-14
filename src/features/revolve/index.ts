// Ring 1 – Revolve feature plugin (spec 11, Plugin featury).
// Public API of features/revolve. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { revolveBuilder } from './builder';
import { revolveMessages } from './messages';
import { revolveSchema } from './schema';
import type { RevolveParams } from './schema';
import { revolveTool } from './tool';

export type { RevolveParams } from './schema';

export const revolvePlugin: FeaturePlugin<RevolveParams> = Object.freeze<
  FeaturePlugin<RevolveParams>
>({
  schema: revolveSchema,
  builder: revolveBuilder,
  tools: Object.freeze([revolveTool]),
  messages: revolveMessages,
});
