// The feature plugins of the application. Only app may import features/* (spec 01), so the
// list lives here; main.ts hands it to ui, which passes it to openAppSession. A new feature
// type = one line here and nothing in ui (spec 11, "Komponenty").

import { booleanPlugin } from '@/features/boolean';
import { boxPlugin } from '@/features/box';
import { chamferPlugin } from '@/features/chamfer';
import { cylinderPlugin } from '@/features/cylinder';
import { extrudePlugin } from '@/features/extrude';
import { filletPlugin } from '@/features/fillet';
import { revolvePlugin } from '@/features/revolve';
import { sketchPlugin } from '@/features/sketch';
import { transformPlugin } from '@/features/transform';
import type { FeaturePlugin } from '@/plugin-api';

/** The order is the order of the tools within a toolbar group. */
export const BUILT_IN_PLUGINS: readonly FeaturePlugin[] = Object.freeze([
  boxPlugin,
  cylinderPlugin,
  transformPlugin,
  booleanPlugin,
  sketchPlugin,
  extrudePlugin,
  revolvePlugin,
  filletPlugin,
  chamferPlugin,
]);
