import { browserStorage } from '../storage';
import { createDisplayStyleController } from './display-style';
import type { DisplayStyleController } from './display-style';

// Browser binding of the display style controller. Like the orbit mode, the style belongs to the
// page, not to a session, so there is one controller for the whole app, created on first use.

let controller: DisplayStyleController | null = null;

export function useDisplayStyle(): DisplayStyleController {
  controller ??= createDisplayStyleController({ storage: browserStorage() });
  return controller;
}
