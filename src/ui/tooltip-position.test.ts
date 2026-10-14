import { describe, expect, it } from 'vitest';
import { placeTooltip } from './tooltip-position';

describe('placeTooltip', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 200, height: 60 };

  it('a tooltip that fits stands above the anchor, centred, the gap between', () => {
    const anchor = { left: 400, top: 700, width: 40, height: 40 };
    // centre 420 − 100 = 320; 700 − 8 − 60 = 632.
    expect(placeTooltip(anchor, size, viewport)).toEqual({ left: 320, top: 632 });
  });

  it('overflowing on the left it is moved right to the margin', () => {
    const anchor = { left: 10, top: 700, width: 40, height: 40 };
    expect(placeTooltip(anchor, size, viewport)).toEqual({ left: 8, top: 632 });
  });

  it('overflowing on the right it is moved left to the margin', () => {
    const anchor = { left: 950, top: 700, width: 40, height: 40 };
    expect(placeTooltip(anchor, size, viewport)).toEqual({ left: 792, top: 632 });
  });

  it('without room above it goes below the anchor', () => {
    const anchor = { left: 400, top: 50, width: 40, height: 40 };
    // 50 − 8 − 60 < 8 → 50 + 40 + 8 = 98.
    expect(placeTooltip(anchor, size, viewport)).toEqual({ left: 320, top: 98 });
  });

  it('exactly enough room above keeps it above', () => {
    const anchor = { left: 400, top: 76, width: 40, height: 40 };
    expect(placeTooltip(anchor, size, viewport)).toEqual({ left: 320, top: 8 });
  });

  it('a tooltip wider than the window sticks to the left margin', () => {
    const anchor = { left: 400, top: 700, width: 40, height: 40 };
    expect(placeTooltip(anchor, { width: 1200, height: 60 }, viewport)).toEqual({
      left: 8,
      top: 632,
    });
  });

  it('uses the gap and the margin it gets', () => {
    const anchor = { left: 0, top: 700, width: 40, height: 40 };
    expect(placeTooltip(anchor, size, viewport, 4, 0)).toEqual({ left: 0, top: 636 });
  });
});
