import { describe, expect, it } from 'vitest';
import { viewChangedSince, type ViewSnapshot } from '@/render/view-change';

const BASE: ViewSnapshot = {
  target: [1, 2, 3],
  orientation: [0, 0, 0, 1],
  halfHeight: 50,
  width: 800,
  height: 600,
};

describe('viewChangedSince', () => {
  it('reports nothing for the same state, also in fresh objects', () => {
    expect(viewChangedSince(BASE, BASE)).toBe(false);
    expect(
      viewChangedSince(BASE, {
        ...BASE,
        target: [1, 2, 3],
        orientation: [0, 0, 0, 1],
      }),
    ).toBe(false);
  });

  it('reports the first frame (no previous one)', () => {
    expect(viewChangedSince(null, BASE)).toBe(true);
  });

  it('reports a change of the target, the orientation or halfHeight', () => {
    expect(viewChangedSince(BASE, { ...BASE, target: [1, 2, 3.5] })).toBe(true);
    expect(viewChangedSince(BASE, { ...BASE, orientation: [0, 0, 0.1, 0.995] })).toBe(true);
    expect(viewChangedSince(BASE, { ...BASE, halfHeight: 49 })).toBe(true);
  });

  it('reports a change of the size of the view area', () => {
    expect(viewChangedSince(BASE, { ...BASE, width: 801 })).toBe(true);
    expect(viewChangedSince(BASE, { ...BASE, height: 599 })).toBe(true);
  });
});
