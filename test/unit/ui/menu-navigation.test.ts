import { describe, expect, it } from 'vitest';
import { isMenuNavigationKey, menuFocusIndex } from '@/ui/menu-navigation';

describe('menuFocusIndex', () => {
  // Disabled items at both ends and in the middle.
  const enabled = [false, true, true, false, true, false];

  it('Home and End go to the first and the last enabled item', () => {
    expect(menuFocusIndex(enabled, 2, 'Home')).toBe(1);
    expect(menuFocusIndex(enabled, 2, 'End')).toBe(4);
    expect(menuFocusIndex(enabled, null, 'Home')).toBe(1);
    expect(menuFocusIndex(enabled, null, 'End')).toBe(4);
  });

  it('ArrowDown and ArrowUp move to the next and the previous enabled item', () => {
    expect(menuFocusIndex(enabled, 1, 'ArrowDown')).toBe(2);
    expect(menuFocusIndex(enabled, 4, 'ArrowUp')).toBe(2);
  });

  it('the arrows skip disabled items', () => {
    expect(menuFocusIndex(enabled, 2, 'ArrowDown')).toBe(4);
    expect(menuFocusIndex(enabled, 2, 'ArrowUp')).toBe(1);
  });

  it('the arrows stay on the last and the first enabled item', () => {
    expect(menuFocusIndex(enabled, 4, 'ArrowDown')).toBe(4);
    expect(menuFocusIndex(enabled, 1, 'ArrowUp')).toBe(1);
  });

  it('without a focused item ArrowDown goes to the first, ArrowUp to the last enabled item', () => {
    expect(menuFocusIndex(enabled, null, 'ArrowDown')).toBe(1);
    expect(menuFocusIndex(enabled, null, 'ArrowUp')).toBe(4);
  });

  it('no enabled item → null', () => {
    expect(menuFocusIndex([false, false], null, 'ArrowDown')).toBeNull();
    expect(menuFocusIndex([false, false], 0, 'Home')).toBeNull();
    expect(menuFocusIndex([], null, 'End')).toBeNull();
  });
});

describe('isMenuNavigationKey', () => {
  it('accepts the arrows up and down, Home and End', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(isMenuNavigationKey(key)).toBe(true);
    }
  });

  it('rejects other keys', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Escape', 'Enter', 'Tab', 'a']) {
      expect(isMenuNavigationKey(key)).toBe(false);
    }
  });
});
