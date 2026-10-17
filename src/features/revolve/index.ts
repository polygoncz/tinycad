// Ring 1 – Revolve feature plugin (spec 11, Plugin featury).
// Public API of features/revolve. Everything else in this folder is internal.

import type { FeaturePlugin } from '@/plugin-api';
import { revolveMessages } from './messages';
import type { RevolveParams } from './params';
import { revolveTool } from './tool';

export type { RevolveParams } from './params';

export const revolvePlugin: FeaturePlugin<RevolveParams> = Object.freeze<
  FeaturePlugin<RevolveParams>
>({
  type: 'revolve',
  tools: Object.freeze([revolveTool]),
  messages: revolveMessages,
});
