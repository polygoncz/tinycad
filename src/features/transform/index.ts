// Ring 1 – Transform feature plugin (spec 11, Plugin featury).
// Public API of features/transform. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import type { TransformAnchors } from './anchors';
import { transformManipulators } from './manipulators';
import { transformMessages } from './messages';
import type { TransformParams } from './params';
import { transformTool } from './tool';

export type { TransformParams } from './params';
export type { TransformAnchors } from './anchors';

export const transformPlugin: FeaturePlugin<TransformParams, TransformAnchors> = Object.freeze<
  FeaturePlugin<TransformParams, TransformAnchors>
>({
  type: 'transform',
  tools: Object.freeze([transformTool]),
  messages: transformMessages,
  manipulators: transformManipulators,
});
