import { describe, expect, expectTypeOf, it } from 'vitest';
import * as sketch from '@/sketch';
import type { Curve2, SketchConstraint, SketchConstraintDraft } from '@/sketch';

// Guards the public API: a value export removed or added by accident shows up here.
describe('sketch public API', () => {
  it('exports exactly the runtime values of spec 12', () => {
    expect(Object.keys(sketch).sort()).toEqual(
      [
        'DIMENSION_KINDS',
        'GEOMETRIC_CONSTRAINT_KINDS',
        'MAX_PATTERN_COUNT',
        'ORIGIN_SNAP',
        'SKETCH_FEATURE_TYPE',
        'SKETCH_PARAM',
        'SPLINE_TOLERANCE',
        'arcFrom3',
        'circleFrom2',
        'circleFrom3',
        'computeRegions',
        'constraintFor',
        'constraintTargets',
        'curvePoints',
        'curve2',
        'defaultPlacement',
        'dimensionFor',
        'endTangent',
        'inferLine',
        'inferRadius',
        'dimensionTarget',
        'isDimension',
        'isPattern',
        'measure',
        'movePlacement',
        'parseSketchData',
        'patternCopies',
        'patternOfCopy',
        'placeDimension',
        'pointsById',
        'removeItems',
        'snap',
        'tangentArcFrom',
        'tangentCircle',
        'toggleConstruction',
      ].sort(),
    );
  });

  it('has the constants of spec 12', () => {
    expect(sketch.SKETCH_FEATURE_TYPE).toBe('sketch');
    expect(sketch.GEOMETRIC_CONSTRAINT_KINDS).toEqual([
      'coincident',
      'horizontal',
      'vertical',
      'parallel',
      'perpendicular',
      'equal',
      'tangent',
      'midpoint',
      'symmetric',
      'fix',
    ]);
    expect(Object.isFrozen(sketch.GEOMETRIC_CONSTRAINT_KINDS)).toBe(true);
  });

  it('has the pattern constants of M36', () => {
    expect(sketch.MAX_PATTERN_COUNT).toBe(100);
    const parsed = sketch.parseSketchData(
      [
        { kind: 'point', id: 'a', x: 0, y: 0 },
        { kind: 'point', id: 'b', x: 0, y: 1 },
        { kind: 'line', id: 'l', p1: 'a', p2: 'b' },
        { kind: 'mirror', id: 'm', sources: ['a'], axis: 'l' },
      ],
      [],
    );
    expect(parsed.ok && parsed.value.entities.map(sketch.isPattern)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it('tells a dimension by its kind (M28), not by a value field', () => {
    expect(sketch.DIMENSION_KINDS).toEqual([
      'distance',
      'hDistance',
      'vDistance',
      'pointLineDistance',
      'angle',
      'radius',
      'diameter',
    ]);
    expect(Object.isFrozen(sketch.DIMENSION_KINDS)).toBe(true);
    expect(sketch.isDimension({ kind: 'angle' })).toBe(true);
    expect(sketch.isDimension({ kind: 'horizontal', value: 1 })).toBe(false);
  });

  it('names the params of the sketch feature (SKETCH_PARAM)', () => {
    expect(sketch.SKETCH_PARAM).toEqual({
      plane: 'plane',
      entities: 'entities',
      constraints: 'constraints',
    });
    expect(Object.isFrozen(sketch.SKETCH_PARAM)).toBe(true);
    expectTypeOf(sketch.SKETCH_PARAM).toEqualTypeOf<{
      readonly plane: 'plane';
      readonly entities: 'entities';
      readonly constraints: 'constraints';
    }>();
  });

  it('SketchConstraintDraft is a constraint without its id', () => {
    expectTypeOf<SketchConstraintDraft>().toEqualTypeOf<
      SketchConstraint extends infer C ? (C extends unknown ? Omit<C, 'id'> : never) : never
    >();
  });

  it('Curve2 has the shape of ProfileCurve, with the optional entity id of M14 and the bspline of M29 (spec 06, 12)', () => {
    expectTypeOf<Curve2>().toEqualTypeOf<
      | {
          readonly kind: 'line';
          readonly from: readonly [number, number];
          readonly to: readonly [number, number];
          readonly id?: string;
        }
      | {
          readonly kind: 'arc';
          readonly center: readonly [number, number];
          readonly from: readonly [number, number];
          readonly to: readonly [number, number];
          readonly ccw: boolean;
          readonly id?: string;
        }
      | {
          readonly kind: 'circle';
          readonly center: readonly [number, number];
          readonly radius: number;
          readonly id?: string;
        }
      | {
          readonly kind: 'bspline';
          readonly degree: number;
          readonly poles: readonly (readonly [number, number])[];
          readonly knots: readonly number[];
          readonly id?: string;
        }
    >();
  });
});
