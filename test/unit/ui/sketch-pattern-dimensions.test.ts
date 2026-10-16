import { describe, expect, it, vi } from 'vitest';
import type { Vec3 } from '@/core';
import type { SketchPatternDimensionView } from '@/sketcher';
import type { ScreenPoint } from '@/ui/manipulator-hud';
import {
  commitPatternEdit,
  editedPatternValue,
  patternDimensionLabel,
  patternDimensionLayout,
  patternFieldText,
} from '@/ui/sketch-pattern-dimensions';

// Test ids are trusted.
const eid = (id: string): SketchPatternDimensionView['pattern'] =>
  id as SketchPatternDimensionView['pattern'];

function aPatternDimension(
  overrides: Partial<SketchPatternDimensionView> = {},
): SketchPatternDimensionView {
  return {
    pattern: eid('p1'),
    param: 'spacing1',
    format: 'length',
    value: 20,
    label: [10, 5, 0],
    guide: [
      [0, 0, 0],
      [20, 0, 0],
    ],
    ...overrides,
  };
}

/** A top view 1 mm = 1 px with the origin at (100, 200); the point x = 99 does not project. */
const project = (world: Vec3): ScreenPoint | null =>
  world[0] === 99 ? null : [100 + world[0], 200 - world[1]];

describe('patternDimensionLayout', () => {
  it('projects the label and draws the guide as a polyline without arrows', () => {
    const layout = patternDimensionLayout(
      aPatternDimension({
        guide: [
          [0, 0, 0],
          [10, 10, 0],
          [20, 0, 0],
        ],
      }),
      project,
    );
    expect(layout).toEqual({
      lines: [
        [
          [100, 200],
          [110, 190],
        ],
        [
          [110, 190],
          [120, 200],
        ],
      ],
      arrows: [],
      labelAt: [110, 195],
    });
  });

  it('an empty guide is only the label', () => {
    const layout = patternDimensionLayout(
      aPatternDimension({ format: 'count', value: 3, guide: [] }),
      project,
    );
    expect(layout).toEqual({ lines: [], arrows: [], labelAt: [110, 195] });
  });

  it('is null when the label or a point of the guide does not project', () => {
    expect(patternDimensionLayout(aPatternDimension({ label: [99, 0, 0] }), project)).toBeNull();
    expect(
      patternDimensionLayout(
        aPatternDimension({
          guide: [
            [0, 0, 0],
            [99, 0, 0],
          ],
        }),
        project,
      ),
    ).toBeNull();
  });
});

describe('patternDimensionLabel', () => {
  it('a count is "n×"', () => {
    expect(patternDimensionLabel(aPatternDimension({ format: 'count', value: 4 }))).toBe('4×');
    // count2 without the second direction.
    expect(
      patternDimensionLabel(aPatternDimension({ param: 'count2', format: 'count', value: 1 })),
    ).toBe('1×');
  });

  it('a length is rounded like a dimension, in mm', () => {
    expect(patternDimensionLabel(aPatternDimension({ value: 12.3456 }))).toBe('12.35 mm');
    expect(patternDimensionLabel(aPatternDimension({ value: 20 }))).toBe('20 mm');
  });

  it('an angle is in degrees, rounded like an angle dimension', () => {
    expect(patternDimensionLabel(aPatternDimension({ format: 'angle', value: Math.PI / 2 }))).toBe(
      '90°',
    );
    expect(patternDimensionLabel(aPatternDimension({ format: 'angle', value: 1 }))).toBe('57.3°');
  });
});

describe('patternFieldText', () => {
  it('is the shown number without the unit', () => {
    expect(patternFieldText(aPatternDimension({ format: 'count', value: 4 }))).toBe('4');
    expect(patternFieldText(aPatternDimension({ value: 12.3456 }))).toBe('12.35');
    expect(patternFieldText(aPatternDimension({ format: 'angle', value: Math.PI }))).toBe('180');
  });
});

describe('editedPatternValue', () => {
  it('a length is taken as it is, with "," as the decimal mark', () => {
    expect(editedPatternValue('15,5', aPatternDimension())).toBe(15.5);
  });

  it('an angle in degrees becomes radians', () => {
    expect(editedPatternValue('90', aPatternDimension({ format: 'angle', value: 0 }))).toBeCloseTo(
      Math.PI / 2,
    );
  });

  it('a count must be an integer', () => {
    const count = aPatternDimension({ param: 'count1', format: 'count', value: 3 });
    expect(editedPatternValue('5', count)).toBe(5);
    expect(editedPatternValue('5.5', count)).toBeNull();
  });

  it('no number or the shown number is null', () => {
    expect(editedPatternValue('abc', aPatternDimension())).toBeNull();
    expect(editedPatternValue('', aPatternDimension())).toBeNull();
    expect(editedPatternValue('12.35', aPatternDimension({ value: 12.3456 }))).toBeNull();
  });
});

describe('commitPatternEdit', () => {
  it('writes the converted value through setPatternParam', () => {
    const setPatternParam = vi.fn(() => true);
    const dim = aPatternDimension({ param: 'angle', format: 'angle', value: Math.PI });
    expect(commitPatternEdit({ setPatternParam }, dim, '90')).toBe(true);
    expect(setPatternParam).toHaveBeenCalledWith(eid('p1'), 'angle', Math.PI / 2);
  });

  it('a count goes as an integer', () => {
    const setPatternParam = vi.fn(() => true);
    const dim = aPatternDimension({ param: 'count2', format: 'count', value: 1 });
    commitPatternEdit({ setPatternParam }, dim, '3');
    expect(setPatternParam).toHaveBeenCalledWith(eid('p1'), 'count2', 3);
  });

  it('an invalid or unchanged text does not call setPatternParam', () => {
    const setPatternParam = vi.fn(() => true);
    const count = aPatternDimension({ param: 'count1', format: 'count', value: 3 });
    expect(commitPatternEdit({ setPatternParam }, count, '2.5')).toBe(false);
    expect(commitPatternEdit({ setPatternParam }, count, 'x')).toBe(false);
    expect(commitPatternEdit({ setPatternParam }, count, '3')).toBe(false);
    expect(setPatternParam).not.toHaveBeenCalled();
  });

  it('reports a value the session refuses', () => {
    const setPatternParam = vi.fn(() => false);
    expect(commitPatternEdit({ setPatternParam }, aPatternDimension(), '-5')).toBe(false);
    expect(setPatternParam).toHaveBeenCalledOnce();
  });
});
