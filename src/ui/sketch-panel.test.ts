import { describe, expect, it } from 'vitest';
import type { SketchState } from '@/interaction';
import { constraintRowLabel, sketchStatusText } from './sketch-panel';

function aState(change: Partial<SketchState>): SketchState {
  return {
    open: true,
    name: 'Skica 1',
    entities: [],
    constraints: [],
    status: 'ok',
    dof: 2,
    fullyDefined: false,
    selection: [],
    hover: null,
    message: null,
    constraintRows: [],
    editingDimension: null,
    ...change,
  };
}

describe('sketchStatusText', () => {
  it('fully defined', () => {
    expect(sketchStatusText(aState({ dof: 0, fullyDefined: true }))).toEqual({
      key: 'sketch.status.defined',
      params: {},
    });
  });

  it('degrees of freedom while not fully defined', () => {
    expect(sketchStatusText(aState({ dof: 2 }))).toEqual({
      key: 'sketch.status.dof',
      params: { n: 2 },
    });
  });

  it('solving before the first result', () => {
    expect(sketchStatusText(aState({ status: 'solving', dof: null })).key).toBe(
      'sketch.status.solving',
    );
  });

  it('a conflicting or failed last solve', () => {
    expect(sketchStatusText(aState({ status: 'conflict' })).key).toBe('sketch.conflict');
    expect(sketchStatusText(aState({ status: 'failed', dof: null })).key).toBe(
      'sketch.solverFailed',
    );
  });
});

describe('constraintRowLabel', () => {
  it('is the translated kind and the number of the row', () => {
    const t = (key: string): string => (key === 'sketch.constraint.distance' ? 'Vzdálenost' : key);
    expect(constraintRowLabel(t, { kind: 'distance', n: 2 })).toBe('Vzdálenost 2');
  });
});
