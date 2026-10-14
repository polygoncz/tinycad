import { browserStorage } from '../storage';
import { createOrbitModeController } from './orbit-mode';
import type { OrbitModeController } from './orbit-mode';

// Browser binding of the rotation mode controller. Like the theme, the mode belongs to the page,
// not to a session, so there is one controller for the whole app, created on first use.

let controller: OrbitModeController | null = null;

export function useOrbitMode(): OrbitModeController {
  controller ??= createOrbitModeController({ storage: browserStorage() });
  return controller;
}
