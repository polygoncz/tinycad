import { describe, expect, it } from 'vitest';
import { isLineCarrier } from '@/sketch/model';
import type { SketchData } from '@/sketch/model';
import { parseSketchData } from '@/sketch/parse';

function sketch(entities: readonly unknown[]): SketchData {
  const r = parseSketchData(entities, []);
  if (!r.ok) throw new Error(`invalid test sketch: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe('isLineCarrier', () => {
  const DATA = sketch([
    { kind: 'point', id: 'a', x: 0, y: 0 },
    { kind: 'point', id: 'b', x: 10, y: 0 },
    { kind: 'point', id: 'c', x: 0, y: 10 },
    { kind: 'line', id: 'l', p1: 'a', p2: 'b' },
    { kind: 'xline', id: 'x', p1: 'a', p2: 'c', construction: true },
    { kind: 'circle', id: 'k', center: 'a', radius: 3 },
    { kind: 'arc', id: 'q', center: 'a', start: 'b', end: 'c' },
    { kind: 'bspline', id: 's', degree: 1, poles: ['a', 'b'], knots: [0, 0, 1, 1] },
  ]);

  it('is true for a line and an xline (M31), false for every other entity', () => {
    const carriers = DATA.entities.filter(isLineCarrier).map((e) => e.id);
    expect(carriers).toEqual(['l', 'x']);
  });
});
