import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import type { OrbitMode } from '@/app';
import type { KeyValueStorage } from '../storage';

// Rotation mode of the camera (spec 11, "Režim otáčení (M17.1)", ADR 0020): a page preference
// like the theme. Turntable keeps Z up, free rotates without limits. The choice is remembered;
// the environment is passed in, so the logic runs in Node tests. use-orbit-mode.ts binds it to
// the browser, AppShell hands the mode to the session and toggles on the view cube button.

export interface OrbitModeEnv {
  /** null when storage is unavailable. */
  readonly storage: KeyValueStorage | null;
}

export interface OrbitModeController {
  readonly mode: Readonly<ShallowRef<OrbitMode>>;
  toggle(): void;
}

const ORBIT_MODE_KEY = 'tinycad.orbitMode';
const DEFAULT_ORBIT_MODE: OrbitMode = 'turntable';

/** Stored choice if valid, else the default. */
function pickOrbitMode(stored: string | null): OrbitMode {
  if (stored === 'turntable' || stored === 'free') return stored;
  return DEFAULT_ORBIT_MODE;
}

/** Only an explicit toggle is remembered. */
export function createOrbitModeController(env: OrbitModeEnv): OrbitModeController {
  const mode = shallowRef(pickOrbitMode(env.storage?.getItem(ORBIT_MODE_KEY) ?? null));

  return {
    mode,
    toggle: () => {
      const next: OrbitMode = mode.value === 'turntable' ? 'free' : 'turntable';
      mode.value = next;
      env.storage?.setItem(ORBIT_MODE_KEY, next);
    },
  };
}
