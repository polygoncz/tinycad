// Conversion of DOM pointer and key events into the viewport port's events (spec 09,
// "Události"). Takes plain values, not DOM types, so it is testable in Node.

import type { KeyMods, ViewKeyEvent, ViewPointerEvent } from '@/interaction';

export interface ModifierInput {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export interface PointerInput extends ModifierInput {
  readonly type: ViewPointerEvent['type'];
  /** Offset relative to the canvas in px (PointerEvent.offsetX/offsetY). */
  readonly offsetX: number;
  readonly offsetY: number;
  /** PointerEvent.button: 0 left, 1 middle, 2 right. */
  readonly button: number;
}

export interface KeyInput extends ModifierInput {
  readonly key: string;
}

const BUTTONS: Readonly<Record<number, ViewPointerEvent['button']>> = {
  0: 'left',
  1: 'middle',
  2: 'right',
};

function toMods(input: ModifierInput, isMac: boolean): KeyMods {
  return {
    shift: input.shiftKey,
    alt: input.altKey,
    mod: isMac ? input.metaKey : input.ctrlKey,
  };
}

export function toViewPointerEvent(input: PointerInput, isMac: boolean): ViewPointerEvent {
  // move and leave report no button: PointerEvent.button is -1 or meaningless for them.
  const hasButton = input.type === 'down' || input.type === 'up';
  return {
    type: input.type,
    x: input.offsetX,
    y: input.offsetY,
    button: hasButton ? (BUTTONS[input.button] ?? null) : null,
    mods: toMods(input, isMac),
  };
}

export function toViewKeyEvent(
  input: KeyInput,
  isMac: boolean,
  inTextField: boolean,
): ViewKeyEvent {
  return { key: input.key, mods: toMods(input, isMac), inTextField };
}
