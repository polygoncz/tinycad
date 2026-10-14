import { describe, expect, it } from 'vitest';
import { constraintRowLabel } from './sketch-panel';

describe('constraintRowLabel', () => {
  it('is the translated kind and the number of the row', () => {
    const t = (key: string): string => (key === 'sketch.constraint.distance' ? 'Vzdálenost' : key);
    expect(constraintRowLabel(t, { kind: 'distance', n: 2 })).toBe('Vzdálenost 2');
  });
});
