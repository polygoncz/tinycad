// Ring 1 – Extrude feature plugin (spec 11, Plugin featury; M13).
// Public API of features/extrude. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { extrudeBuilder } from './builder';
import { extrudeMessages } from './messages';
import { extrudeSchema } from './schema';
import type { ExtrudeParams } from './schema';
import { extrudeTool } from './tool';

export type { ExtrudeParams } from './schema';

export const extrudePlugin: FeaturePlugin<ExtrudeParams> = Object.freeze<
  FeaturePlugin<ExtrudeParams>
>({
  schema: extrudeSchema,
  builder: extrudeBuilder,
  tools: Object.freeze([extrudeTool]),
  messages: extrudeMessages,
});
