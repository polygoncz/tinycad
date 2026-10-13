import type { ViewKeyEvent } from '@/interaction';

// Adapter of the global keyboard (spec 10, "Port viewportu"): a DOM KeyboardEvent becomes a
// ViewKeyEvent for ActionRegistry.handleKey. Cmd (Apple) / Ctrl (elsewhere) becomes mods.mod,
// so interaction never knows the platform. Takes plain values, not DOM types, so it is
// testable in Node; a KeyboardEvent fits KeyInput as it is.

export interface KeyInput {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  /** KeyboardEvent.target: the focused element. */
  readonly target: unknown;
}

/** Input types that do not take text: shortcuts stay active while they have focus. */
const NON_TEXT_INPUTS: ReadonlySet<string> = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'image',
  'file',
  'range',
  'color',
]);

export function toViewKeyEvent(e: KeyInput, isMac: boolean): ViewKeyEvent {
  return {
    key: e.key,
    mods: { shift: e.shiftKey, alt: e.altKey, mod: isMac ? e.metaKey : e.ctrlKey },
    inTextField: inTextField(e.target),
  };
}

/** True for elements that take typed text, where keys belong to the field, not to shortcuts. */
export function inTextField(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  if ('isContentEditable' in target && target.isContentEditable === true) return true;
  const tag = 'tagName' in target && typeof target.tagName === 'string' ? target.tagName : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = 'type' in target && typeof target.type === 'string' ? target.type : '';
  return !NON_TEXT_INPUTS.has(type.toLowerCase());
}

/** Apple platforms use Cmd for shortcuts (same test as render's viewport). */
export function isMacPlatform(userAgent: string): boolean {
  return /Mac|iPhone|iPad|iPod/.test(userAgent);
}

/** Symbols of named keys and modifiers as macOS menus show them. */
const MAC_KEYS: Readonly<Record<string, string>> = Object.freeze({
  Mod: '⌘',
  Shift: '⇧',
  Alt: '⌥',
  Delete: '⌫',
  Backspace: '⌫',
  Enter: '↩',
  Escape: '⎋',
});
const OTHER_KEYS: Readonly<Record<string, string>> = Object.freeze({
  Mod: 'Ctrl',
  Shift: 'Shift',
  Alt: 'Alt',
});

/** 'Mod+Shift+Z' → '⌘⇧Z' on macOS, 'Ctrl+Shift+Z' elsewhere (spec 10: formatting is ui's). */
export function shortcutText(shortcut: string, isMac: boolean): string {
  const names = isMac ? MAC_KEYS : OTHER_KEYS;
  const tokens = shortcut.split('+').map((token) => names[token] ?? token.toUpperCase());
  return tokens.join(isMac ? '' : '+');
}
