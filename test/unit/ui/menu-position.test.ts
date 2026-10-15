import { describe, expect, it } from 'vitest';
import { placeMenu } from '@/ui/menu-position';

describe('placeMenu', () => {
  const viewport = { width: 800, height: 600 };
  const size = { width: 200, height: 150 };

  it('a menu that fits opens right of and below the anchor', () => {
    expect(placeMenu({ x: 100, y: 50 }, size, viewport)).toEqual({ left: 100, top: 50 });
  });

  it('a menu that fits up to the margin still opens at the anchor', () => {
    expect(placeMenu({ x: 592, y: 442 }, size, viewport)).toEqual({ left: 592, top: 442 });
  });

  it('a menu overflowing on the right turns to the left of the anchor', () => {
    expect(placeMenu({ x: 700, y: 50 }, size, viewport)).toEqual({ left: 500, top: 50 });
  });

  it('a menu overflowing at the bottom turns up from the anchor', () => {
    expect(placeMenu({ x: 100, y: 500 }, size, viewport)).toEqual({ left: 100, top: 350 });
  });

  it('a menu overflowing on the right and at the bottom turns left and up', () => {
    expect(placeMenu({ x: 700, y: 580 }, size, viewport)).toEqual({ left: 500, top: 430 });
  });

  it('a turned menu that would leave the window is moved inside, the margin kept', () => {
    // 400 + 500 > 800 − 8 turns left to −100, under the margin → 8; 300 + 400 > 600 − 8 turns
    // up to −100 → 8. The menu is smaller than the window, it fits on neither side of the anchor.
    const big = { width: 500, height: 400 };
    expect(placeMenu({ x: 400, y: 300 }, big, viewport)).toEqual({ left: 8, top: 8 });
  });

  it('a menu larger than the window sticks to the top left margin', () => {
    const huge = { width: 900, height: 700 };
    expect(placeMenu({ x: 300, y: 200 }, huge, viewport)).toEqual({ left: 8, top: 8 });
  });

  it('uses the margin it gets', () => {
    expect(placeMenu({ x: 795, y: 595 }, size, viewport, 0)).toEqual({ left: 595, top: 445 });
    expect(placeMenu({ x: 10, y: 10 }, { width: 900, height: 700 }, viewport, 20)).toEqual({
      left: 20,
      top: 20,
    });
  });
});
