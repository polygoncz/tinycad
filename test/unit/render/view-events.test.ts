import { describe, expect, it } from 'vitest';
import { toViewKeyEvent, toViewPointerEvent } from '@/render/view-events';

const noMods = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
const pointer = (type: 'down' | 'move' | 'up' | 'leave', button: number) => ({
  type,
  offsetX: 10,
  offsetY: 20,
  button,
  ...noMods,
});

describe('toViewPointerEvent', () => {
  it('maps buttons 0/1/2 to left/middle/right, others to null', () => {
    expect(toViewPointerEvent(pointer('down', 0), false).button).toBe('left');
    expect(toViewPointerEvent(pointer('down', 1), false).button).toBe('middle');
    expect(toViewPointerEvent(pointer('up', 2), false).button).toBe('right');
    expect(toViewPointerEvent(pointer('down', 3), false).button).toBeNull();
    expect(toViewPointerEvent(pointer('up', -1), false).button).toBeNull();
  });

  it('move and leave never carry a button', () => {
    expect(toViewPointerEvent(pointer('move', 0), false).button).toBeNull();
    expect(toViewPointerEvent(pointer('leave', 2), false).button).toBeNull();
  });

  it('copies type and offset coordinates', () => {
    expect(toViewPointerEvent(pointer('down', 0), false)).toEqual({
      type: 'down',
      x: 10,
      y: 20,
      button: 'left',
      mods: { shift: false, alt: false, mod: false },
    });
  });

  it('mod is Meta on Mac and Ctrl elsewhere', () => {
    const meta = { ...pointer('down', 0), metaKey: true };
    const ctrl = { ...pointer('down', 0), ctrlKey: true };
    expect(toViewPointerEvent(meta, true).mods.mod).toBe(true);
    expect(toViewPointerEvent(ctrl, true).mods.mod).toBe(false);
    expect(toViewPointerEvent(meta, false).mods.mod).toBe(false);
    expect(toViewPointerEvent(ctrl, false).mods.mod).toBe(true);
  });

  it('copies shift and alt', () => {
    const input = { ...pointer('move', 0), shiftKey: true, altKey: true };
    expect(toViewPointerEvent(input, false).mods).toEqual({ shift: true, alt: true, mod: false });
  });
});

describe('toViewKeyEvent', () => {
  it('copies key, mods and inTextField', () => {
    expect(toViewKeyEvent({ key: 'Delete', ...noMods, shiftKey: true }, false, true)).toEqual({
      key: 'Delete',
      mods: { shift: true, alt: false, mod: false },
      inTextField: true,
    });
  });

  it('M32: passes consume on, without it the event has none', () => {
    let consumed = 0;
    const consume = (): void => {
      consumed++;
    };
    const e = toViewKeyEvent({ key: 'Tab', ...noMods }, false, false, consume);
    e.consume?.();
    expect(consumed).toBe(1);
    expect(toViewKeyEvent({ key: 'Tab', ...noMods }, false, false)).not.toHaveProperty('consume');
  });

  it('mod is Meta on Mac and Ctrl elsewhere', () => {
    const meta = { key: 'z', ...noMods, metaKey: true };
    const ctrl = { key: 'z', ...noMods, ctrlKey: true };
    expect(toViewKeyEvent(meta, true, false).mods.mod).toBe(true);
    expect(toViewKeyEvent(ctrl, true, false).mods.mod).toBe(false);
    expect(toViewKeyEvent(meta, false, false).mods.mod).toBe(false);
    expect(toViewKeyEvent(ctrl, false, false).mods.mod).toBe(true);
  });
});
