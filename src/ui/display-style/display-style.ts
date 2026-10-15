import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import { DEFAULT_DISPLAY_STYLE, DISPLAY_MODES } from '@/app';
import type { DisplayMode, DisplayStyle } from '@/app';
import type { KeyValueStorage } from '../storage';

// Display style of the bodies (spec 11, "Styl zobrazení", spec 09): a page preference like the
// orbit mode. The choice is remembered as JSON; the environment is passed in, so the logic runs
// in Node tests. use-display-style.ts binds it to the browser, AppShell hands the style to the
// session.

export interface DisplayStyleEnv {
  /** null when storage is unavailable. */
  readonly storage: KeyValueStorage | null;
}

export interface DisplayStyleController {
  readonly style: Readonly<ShallowRef<DisplayStyle>>;
  setMode(mode: DisplayMode): void;
  /** Kept outside shaded too; only the menu greys it out. */
  toggleEdges(): void;
  /** Kept outside shaded too; only the menu greys it out. */
  toggleTransparent(): void;
  toggleMesh(): void;
  /** Kept outside opaque shaded too; only the menu greys it out. */
  toggleAo(): void;
}

const DISPLAY_STYLE_KEY = 'tinycad.displayStyle';

function isDisplayMode(value: unknown): value is DisplayMode {
  return DISPLAY_MODES.some((mode) => mode === value);
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Stored style validated per field: a field added later (or broken by hand) falls back to its
 * default without dropping the rest. Invalid JSON or a non-object gives the whole default.
 */
function pickDisplayStyle(stored: string | null): DisplayStyle {
  if (stored === null) return DEFAULT_DISPLAY_STYLE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return DEFAULT_DISPLAY_STYLE;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return DEFAULT_DISPLAY_STYLE;
  }
  // A plain object of unknown shape; every field is checked below before use.
  const fields = parsed as Partial<Record<keyof DisplayStyle, unknown>>;
  return Object.freeze({
    mode: isDisplayMode(fields.mode) ? fields.mode : DEFAULT_DISPLAY_STYLE.mode,
    edges: booleanOr(fields.edges, DEFAULT_DISPLAY_STYLE.edges),
    transparent: booleanOr(fields.transparent, DEFAULT_DISPLAY_STYLE.transparent),
    mesh: booleanOr(fields.mesh, DEFAULT_DISPLAY_STYLE.mesh),
    ao: booleanOr(fields.ao, DEFAULT_DISPLAY_STYLE.ao),
  });
}

/** Only an explicit change is remembered; loading writes nothing. */
export function createDisplayStyleController(env: DisplayStyleEnv): DisplayStyleController {
  const style = shallowRef(pickDisplayStyle(env.storage?.getItem(DISPLAY_STYLE_KEY) ?? null));

  const update = (change: Partial<DisplayStyle>): void => {
    const next: DisplayStyle = Object.freeze({ ...style.value, ...change });
    style.value = next;
    env.storage?.setItem(DISPLAY_STYLE_KEY, JSON.stringify(next));
  };

  return {
    style,
    setMode: (mode) => {
      if (mode === style.value.mode) return;
      update({ mode });
    },
    toggleEdges: () => {
      update({ edges: !style.value.edges });
    },
    toggleTransparent: () => {
      update({ transparent: !style.value.transparent });
    },
    toggleMesh: () => {
      update({ mesh: !style.value.mesh });
    },
    toggleAo: () => {
      update({ ao: !style.value.ao });
    },
  };
}
