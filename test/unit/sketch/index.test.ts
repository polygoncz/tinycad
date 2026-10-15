import { describe, expect, expectTypeOf, it } from 'vitest';
import * as sketch from '@/sketch';
import type { Curve2, SketchConstraint, SketchConstraintDraft } from '@/sketch';

// Guards the public API: a value export removed or added by accident shows up here.
describe('sketch public API', () => {
  it('exports exactly the runtime values of spec 12', () => {
    expect(Object.keys(sketch).sort()).toEqual(
      [
        'GEOMETRIC_CONSTRAINT_KINDS',
        'SKETCH_FEATURE_TYPE',
        'SKETCH_PARAM',
        'SPLINE_TOLERANCE',
        'computeRegions',
        'constraintFor',
        'curve2',
        'dimensionFor',
        'measure',
        'parseSketchData',
        'pointsById',
        'removeItems',
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
      'fix',
    ]);
    expect(Object.isFrozen(sketch.GEOMETRIC_CONSTRAINT_KINDS)).toBe(true);
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
