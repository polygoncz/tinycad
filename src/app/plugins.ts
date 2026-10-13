// The feature plugins of the application. Only app may import features/* (spec 01), so the
// list lives here; main.ts hands it to ui, which passes it to openAppSession. A new feature
// type = one line here and nothing in ui (spec 11, "Komponenty").

import { boxPlugin } from '@/features/box';
import type { FeaturePlugin } from '@/plugin-api';

export const BUILT_IN_PLUGINS: readonly FeaturePlugin[] = Object.freeze([boxPlugin]);
