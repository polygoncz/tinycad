// Ring 1 – Extrude feature plugin (spec 11, Plugin featury; M13).
// Public API of features/extrude. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import type { ExtrudeAnchors } from './anchors';
import { extrudeManipulators } from './manipulators';
import { extrudeMessages } from './messages';
import type { ExtrudeParams } from './params';
import { extrudeTool } from './tool';

export type { ExtrudeParams } from './params';
export type { ExtrudeAnchors } from './anchors';

export const extrudePlugin: FeaturePlugin<ExtrudeParams, ExtrudeAnchors> = Object.freeze<
  FeaturePlugin<ExtrudeParams, ExtrudeAnchors>
>({
  type: 'extrude',
  tools: Object.freeze([extrudeTool]),
  messages: extrudeMessages,
  manipulators: extrudeManipulators,
});
