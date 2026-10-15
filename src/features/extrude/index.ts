// Ring 1 – Extrude feature plugin (spec 11, Plugin featury; M13).
// Public API of features/extrude. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { extrudeBuilder } from './builder';
import type { ExtrudeAnchors } from './builder';
import { extrudeManipulators } from './manipulators';
import { extrudeMessages } from './messages';
import { extrudeSchema } from './schema';
import type { ExtrudeParams } from './schema';
import { extrudeTool } from './tool';

export type { ExtrudeParams } from './schema';
export type { ExtrudeAnchors } from './builder';

export const extrudePlugin: FeaturePlugin<ExtrudeParams, ExtrudeAnchors> = Object.freeze<
  FeaturePlugin<ExtrudeParams, ExtrudeAnchors>
>({
  schema: extrudeSchema,
  builder: extrudeBuilder,
  tools: Object.freeze([extrudeTool]),
  messages: extrudeMessages,
  manipulators: extrudeManipulators,
});
