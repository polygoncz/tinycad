import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/core';
import type { DimensionGeometry, SketchDimensionView } from '@/sketcher';
import type { ScreenPoint } from '@/ui/manipulator-hud';
import {
  dimensionFieldText,
  dimensionLabel,
  dimensionLayout,
  dimensionUnit,
  editedDimensionValue,
  fromShownValue,
  toShownValue,
  withLabelGap,
} from '@/ui/sketch-dimensions';

// Test ids are trusted.
const cid = (id: string): SketchDimensionView['id'] => id as SketchDimensionView['id'];

/** A dimension view drawn from `geometry`; the placement is not read by ui. */
function aDimension(
  geometry: DimensionGeometry,
  overrides: Partial<Pick<SketchDimensionView, 'kind' | 'value'>> = {},
): SketchDimensionView {
  const kind =
    overrides.kind ??
    (geometry.kind === 'linear'
      ? 'distance'
      : geometry.kind === 'radial'
        ? geometry.far === null
          ? 'radius'
          : 'diameter'
        : 'angle');
  return {
    id: cid('d1'),
    kind,
    value: overrides.value ?? 40,
    n: 1,
    selected: false,
    placement:
      geometry.kind === 'linear'
        ? { kind: 'linear', offset: 0, along: 0 }
        : geometry.kind === 'radial'
          ? { kind: 'radial', angle: 0, distance: 1 }
          : { kind: 'angular', radius: 1, t: 0.5 },
    geometry,
  };
}

/** A horizontal distance of (0,0)–(40,0) with its line 20 mm above, the label at x = 20 + along. */
function aLinear(along = 0): DimensionGeometry {
  return {
    kind: 'linear',
    from: [0, 0, 0],
    to: [40, 0, 0],
    lineFrom: [0, 20, 0],
    lineTo: [40, 20, 0],
    label: [20 + along, 20, 0],
  };
}

/** A top view 1 mm = 1 px with the origin at (100, 200); screen y grows down. */
const project = (world: Vec3): ScreenPoint => [100 + world[0], 200 - world[1]];

describe('dimensionLayout: linear', () => {
  it('extension lines run past the dimension line, the label stands at the projected label', () => {
    const layout = dimensionLayout(aDimension(aLinear()), project);
    expect(layout).not.toBeNull();
    // from = (100, 200), lineFrom = (100, 180); to = (140, 200), lineTo = (140, 180).
    expect(layout?.lines).toEqual([
      [
        [100, 200],
        [100, 176],
      ],
      [
        [140, 200],
        [140, 176],
      ],
      [
        [100, 180],
        [140, 180],
      ],
    ]);
    expect(layout?.labelAt).toEqual([120, 180]);
  });

  it('has an arrow of 6 px at both ends of the dimension line pointing outwards', () => {
    const layout = dimensionLayout(aDimension(aLinear()), project);
    expect(layout?.arrows).toEqual([
      [
        [100, 180],
        [106, 177],
        [106, 183],
      ],
      [
        [140, 180],
        [134, 183],
        [134, 177],
      ],
    ]);
  });

  it('the dimension line runs on to a label beyond its end', () => {
    const layout = dimensionLayout(aDimension(aLinear(40)), project);
    expect(layout?.lines[2]).toEqual([
      [100, 180],
      [160, 180],
    ]);
    expect(layout?.labelAt).toEqual([160, 180]);
  });

  it('the dimension line runs on to a label before its start', () => {
    const layout = dimensionLayout(aDimension(aLinear(-35)), project);
    expect(layout?.lines[2]).toEqual([
      [85, 180],
      [140, 180],
    ]);
  });

  it('the dimension line below the points (negative offset) has its extension lines downwards', () => {
    const geometry: DimensionGeometry = {
      kind: 'linear',
      from: [0, 0, 0],
      to: [40, 0, 0],
      lineFrom: [0, -10, 0],
      lineTo: [40, -10, 0],
      label: [20, -10, 0],
    };
    const layout = dimensionLayout(aDimension(geometry), project);
    expect(layout?.lines[0]).toEqual([
      [100, 200],
      [100, 214],
    ]);
  });

  it('a point out of the projection → null', () => {
    const partial = (world: Vec3): ScreenPoint | null => (world[0] > 30 ? null : project(world));
    expect(dimensionLayout(aDimension(aLinear()), partial)).toBeNull();
  });

  it('a dimension line shorter than 1 px on the screen → null', () => {
    const geometry: DimensionGeometry = {
      kind: 'linear',
      from: [0, 0, 0],
      to: [0.5, 0, 0],
      lineFrom: [0, 20, 0],
      lineTo: [0.5, 20, 0],
      label: [0.25, 20, 0],
    };
    expect(dimensionLayout(aDimension(geometry), project)).toBeNull();
  });
});

describe('dimensionLayout: radius', () => {
  const radius: DimensionGeometry = {
    kind: 'radial',
    center: [0, 0, 0],
    near: [30, 0, 0],
    far: null,
    label: [50, 0, 0],
  };

  it('a leader from the centre to the curve and on to the label, an arrow on the curve', () => {
    const layout = dimensionLayout(aDimension(radius), project);
    expect(layout?.lines).toEqual([
      [
        [100, 200],
        [130, 200],
      ],
      [
        [130, 200],
        [150, 200],
      ],
    ]);
    expect(layout?.arrows).toEqual([
      [
        [130, 200],
        [124, 203],
        [124, 197],
      ],
    ]);
    expect(layout?.labelAt).toEqual([150, 200]);
  });

  it('the centre out of the projection → null', () => {
    const partial = (world: Vec3): ScreenPoint | null => (world[0] < 10 ? null : project(world));
    expect(dimensionLayout(aDimension(radius), partial)).toBeNull();
  });

  it('a radius shorter than 1 px on the screen → null', () => {
    const tiny: DimensionGeometry = { ...radius, near: [0.5, 0, 0] };
    expect(dimensionLayout(aDimension(tiny), project)).toBeNull();
  });
});

describe('dimensionLayout: diameter', () => {
  const diameter: DimensionGeometry = {
    kind: 'radial',
    center: [0, 0, 0],
    near: [0, 30, 0],
    far: [0, -30, 0],
    label: [0, 45, 0],
  };

  it('a line from far to near through the centre with arrows at both ends, on to the label', () => {
    const layout = dimensionLayout(aDimension(diameter), project);
    // far = (100, 230), near = (100, 170), label = (100, 155).
    expect(layout?.lines).toEqual([
      [
        [100, 230],
        [100, 170],
      ],
      [
        [100, 170],
        [100, 155],
      ],
    ]);
    expect(layout?.arrows).toEqual([
      [
        [100, 170],
        [103, 176],
        [97, 176],
      ],
      [
        [100, 230],
        [97, 224],
        [103, 224],
      ],
    ]);
    expect(layout?.labelAt).toEqual([100, 155]);
  });

  it('far out of the projection → null', () => {
    const partial = (world: Vec3): ScreenPoint | null => (world[1] < -10 ? null : project(world));
    expect(dimensionLayout(aDimension(diameter), partial)).toBeNull();
  });
});

describe('dimensionLayout: angle', () => {
  /** A quarter arc of radius 20 around the origin from the x axis to the y axis, 5 points. */
  const arc: Vec3[] = [0, 1, 2, 3, 4].map((i): Vec3 => {
    const a = (i / 4) * (Math.PI / 2);
    return [20 * Math.cos(a), 20 * Math.sin(a), 0];
  });
  const angle: DimensionGeometry = {
    kind: 'angular',
    vertex: [0, 0, 0],
    arc,
    label: arc[2] ?? [0, 0, 0],
  };

  it('a polyline through the projected points of the arc', () => {
    const layout = dimensionLayout(aDimension(angle), project);
    const projected = arc.map(project);
    expect(layout?.lines).toHaveLength(4);
    layout?.lines.forEach(([a, b], i) => {
      expect(a).toEqual(projected[i]);
      expect(b).toEqual(projected[i + 1]);
    });
    const label = project(arc[2] ?? [0, 0, 0]);
    expect(layout?.labelAt).toEqual(label);
  });

  it('has an arrow at both ends along the arc, pointing outwards', () => {
    const layout = dimensionLayout(aDimension(angle), project);
    const [first, last] = layout?.arrows ?? [];
    expect(first?.[0]).toEqual([120, 200]);
    expect(last?.[0][0]).toBeCloseTo(100);
    expect(last?.[0][1]).toBeCloseTo(180);
    // The base of the first arrow lies towards the next point of the arc (up on the screen).
    const base0 = first?.[1] ?? [0, 0];
    expect(base0[1]).toBeLessThan(200);
    // The base of the last arrow lies towards the previous point (right on the screen).
    const baseN = last?.[1] ?? [0, 0];
    expect(baseN[0]).toBeGreaterThan(100);
  });

  it('a point of the arc out of the projection → null', () => {
    const partial = (world: Vec3): ScreenPoint | null => (world[1] > 19 ? null : project(world));
    expect(dimensionLayout(aDimension(angle), partial)).toBeNull();
  });

  it('an arc shorter than 1 px on the screen → null', () => {
    const tiny: DimensionGeometry = {
      kind: 'angular',
      vertex: [0, 0, 0],
      arc: [
        [0.2, 0, 0],
        [0.1, 0.1, 0],
        [0, 0.2, 0],
      ],
      label: [0.1, 0.1, 0],
    };
    expect(dimensionLayout(aDimension(tiny), project)).toBeNull();
  });
});

describe('withLabelGap', () => {
  // The label '40' at (120, 180): a box of 2 · 7 px of text + 4 px on each side, 16 px high.
  const box = { x0: 109, x1: 131, y0: 172, y1: 188 };

  it('cuts the dimension line around the label, so the text stays readable', () => {
    const layout = dimensionLayout(aDimension(aLinear()), project);
    expect(layout).not.toBeNull();
    if (layout === null) return;
    const gapped = withLabelGap(layout, '40');
    expect(gapped.lines).toEqual([
      layout.lines[0],
      layout.lines[1],
      [
        [100, 180],
        [box.x0, 180],
      ],
      [
        [box.x1, 180],
        [140, 180],
      ],
    ]);
    expect(gapped.arrows).toBe(layout.arrows);
    expect(gapped.labelAt).toBe(layout.labelAt);
  });

  it('a line ending in the box keeps only its part outside (the leader of a radius)', () => {
    const gapped = withLabelGap(
      {
        lines: [
          [
            [60, 180],
            [120, 180],
          ],
        ],
        arrows: [],
        labelAt: [120, 180],
      },
      '40',
    );
    expect(gapped.lines).toEqual([
      [
        [60, 180],
        [box.x0, 180],
      ],
    ]);
  });

  it('a line wholly inside the box is dropped, one away from it is kept', () => {
    const away: readonly [ScreenPoint, ScreenPoint] = [
      [100, 100],
      [140, 100],
    ];
    const gapped = withLabelGap(
      {
        lines: [
          [
            [115, 180],
            [125, 182],
          ],
          away,
        ],
        arrows: [],
        labelAt: [120, 180],
      },
      '40',
    );
    expect(gapped.lines).toEqual([away]);
  });
});

describe('dimensionLabel', () => {
  it('a distance of every kind is the rounded number', () => {
    for (const kind of ['distance', 'hDistance', 'vDistance', 'pointLineDistance'] as const) {
      expect(dimensionLabel({ kind, value: 83.523654 })).toBe('83.52');
    }
  });

  it('a radius has R before it, a diameter ⌀', () => {
    expect(dimensionLabel({ kind: 'radius', value: 40 })).toBe('R40');
    expect(dimensionLabel({ kind: 'diameter', value: 12.345 })).toBe('⌀12.35');
  });

  it('an angle is in degrees with °', () => {
    expect(dimensionLabel({ kind: 'angle', value: Math.PI / 2 })).toBe('90°');
    expect(dimensionLabel({ kind: 'angle', value: 1 })).toBe('57.3°');
  });
});

describe('shown values: degrees for an angle', () => {
  it('an angle is shown in degrees and written in radians', () => {
    expect(toShownValue('angle', Math.PI / 4)).toBeCloseTo(45);
    expect(fromShownValue('angle', 45)).toBeCloseTo(Math.PI / 4);
  });

  it('other kinds are shown as they are', () => {
    expect(toShownValue('distance', 12.5)).toBe(12.5);
    expect(fromShownValue('diameter', 12.5)).toBe(12.5);
  });

  it('the unit of the field is ° for an angle, mm for the rest', () => {
    expect(dimensionUnit('angle')).toBe('°');
    expect(dimensionUnit('pointLineDistance')).toBe('mm');
    expect(dimensionUnit('diameter')).toBe('mm');
  });

  it('the text of the field is the rounded shown value', () => {
    expect(dimensionFieldText({ kind: 'angle', value: 1 })).toBe('57.3');
    expect(dimensionFieldText({ kind: 'radius', value: 83.523654 })).toBe('83.52');
  });
});

describe('editedDimensionValue', () => {
  const distance = (value: number) => ({ kind: 'distance' as const, value });

  it('is the typed number when it differs from the shown value', () => {
    expect(editedDimensionValue('40', distance(83.523654))).toBe(40);
    expect(editedDimensionValue(' 12,5 ', distance(10))).toBe(12.5);
  });

  it('is null for the shown (rounded) value: an untouched field writes nothing', () => {
    expect(editedDimensionValue('83.52', distance(83.523654))).toBeNull();
    expect(editedDimensionValue('40', distance(40))).toBeNull();
  });

  it('is null for a text that is not a number', () => {
    expect(editedDimensionValue('', distance(10))).toBeNull();
    expect(editedDimensionValue('abc', distance(10))).toBeNull();
  });

  it('an angle is typed in degrees and written in radians', () => {
    expect(editedDimensionValue('30', { kind: 'angle', value: 1 })).toBeCloseTo(Math.PI / 6);
  });

  it('an untouched angle field (rounded degrees) writes nothing', () => {
    expect(editedDimensionValue('57.3', { kind: 'angle', value: 1 })).toBeNull();
  });
});
