import { browserStorage } from '../storage';
import { createAoSettingsController } from './ao-settings';
import type { AoSettingsController } from './ao-settings';

// Browser binding of the AO settings controller. Like the display style, the settings belong to
// the page, not to a session, so there is one controller for the whole app, created on first use.

let controller: AoSettingsController | null = null;

export function useAoSettings(): AoSettingsController {
  controller ??= createAoSettingsController({ storage: browserStorage() });
  return controller;
}
