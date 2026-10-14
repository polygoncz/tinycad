import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import type { SketchDimensionView } from '@/interaction';
import type { ScreenPoint } from './manipulator-hud';
import { dimensionLabel, dimensionLayout, editedDimensionValue } from './sketch-dimensions';

// Test ids are trusted.
const cid = (id: string): SketchDimensionView['id'] => id as SketchDimensionView['id'];

function aDimension(overrides: Partial<SketchDimensionView> = {}): SketchDimensionView {
  return {
    id: cid('d1'),
    kind: 'distance',
    value: 40,
    from: [0, 0, 0],
    to: [40, 0, 0],
    n: 1,
    selected: false,
    ...overrides,
  };
}

/** A top view 1 mm = 1 px with the origin at (100, 200); screen y grows down. */
const project = (world: Vec3): ScreenPoint => [100 + world[0], 200 - world[1]];

describe('dimensionLayout: distance', () => {
  it('a horizontal dimension has its line above the points', () => {
    const layout = dimensionLayout(aDimension(), project);
    expect(layout).not.toBeNull();
    // A = (100, 200), B = (140, 200); n = (0, −1).
    expect(layout?.lines).toEqual([
      [
        [100, 200],
        [100, 172],
      ],
      [
        [140, 200],
        [140, 172],
      ],
      [
        [100, 176],
        [140, 176],
      ],
    ]);
    expect(layout?.labelAt).toEqual([120, 166]);
  });

  it('has an arrow of 6 px at both ends pointing outwards', () => {
    const layout = dimensionLayout(aDimension(), project);
    expect(layout?.arrows).toEqual([
      [
        [100, 176],
        [106, 173],
        [106, 179],
      ],
      [
        [140, 176],
        [134, 179],
        [134, 173],
      ],
    ]);
  });

  it('a vertical dimension has its line on the left', () => {
    const layout = dimensionLayout(aDimension({ from: [0, 0, 0], to: [0, 30, 0] }), project);
    // A = (100, 200), B = (100, 170); n = (−1, 0).
    expect(layout?.lines[2]).toEqual([
      [76, 200],
      [76, 170],
    ]);
    expect(layout?.labelAt).toEqual([66, 185]);
  });

  it('the side does not depend on the order of the points', () => {
    const reversed = dimensionLayout(aDimension({ from: [40, 0, 0], to: [0, 0, 0] }), project);
    expect(reversed?.lines[2]).toEqual([
      [140, 176],
      [100, 176],
    ]);
  });

  it('a point out of the projection → null', () => {
    const partial = (world: Vec3): ScreenPoint | null => (world[0] > 10 ? null : project(world));
    expect(dimensionLayout(aDimension(), partial)).toBeNull();
  });

  it('points closer than 1 px on the screen → null', () => {
    expect(dimensionLayout(aDimension({ to: [0.5, 0, 0] }), project)).toBeNull();
  });

  it('uses the offset it gets', () => {
    const layout = dimensionLayout(aDimension(), project, 10);
    expect(layout?.lines[2]).toEqual([
      [100, 190],
      [140, 190],
    ]);
  });
});

describe('dimensionLayout: radius', () => {
  it('a leader from the centre through the curve 16 px further, the label past its end', () => {
    const layout = dimensionLayout(
      aDimension({ kind: 'radius', from: [0, 0, 0], to: [30, 0, 0] }),
      project,
    );
    // C = (100, 200), R = (130, 200); the leader ends at (146, 200).
    expect(layout?.lines).toEqual([
      [
        [100, 200],
        [146, 200],
      ],
    ]);
    expect(layout?.arrows).toEqual([]);
    const label = layout?.labelAt ?? [0, 0];
    expect(label[0]).toBeGreaterThan(146);
    expect(label[1]).toBe(200);
  });

  it('the centre out of the projection → null', () => {
    const partial = (world: Vec3): ScreenPoint | null => (world[0] < 10 ? null : project(world));
    expect(
      dimensionLayout(aDimension({ kind: 'radius', from: [0, 0, 0], to: [30, 0, 0] }), partial),
    ).toBeNull();
  });
});

describe('dimensionLabel', () => {
  it('is the rounded value; a radius has R before it', () => {
    expect(dimensionLabel(aDimension({ value: 83.523654 }))).toBe('83.52');
    expect(dimensionLabel(aDimension({ kind: 'radius', value: 40 }))).toBe('R40');
  });
});

describe('editedDimensionValue', () => {
  it('is the typed number when it differs from the shown value', () => {
    expect(editedDimensionValue('40', 83.523654)).toBe(40);
    expect(editedDimensionValue(' 12,5 ', 10)).toBe(12.5);
  });

  it('is null for the shown (rounded) value: an untouched field writes nothing', () => {
    expect(editedDimensionValue('83.52', 83.523654)).toBeNull();
    expect(editedDimensionValue('40', 40)).toBeNull();
  });

  it('is null for a text that is not a number', () => {
    expect(editedDimensionValue('', 10)).toBeNull();
    expect(editedDimensionValue('abc', 10)).toBeNull();
  });
});
