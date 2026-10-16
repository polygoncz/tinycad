import { describe, expect, it } from 'vitest';
import { parseSketchData } from '@/sketch/parse';
import { pointsById } from '@/sketch/points';

describe('pointsById', () => {
  it('maps point ids to points and skips curves', () => {
    const r = parseSketchData(
      [
        { kind: 'point', id: 'o', x: 1, y: 2 },
        { kind: 'point', id: 's', x: 4, y: 2 },
        { kind: 'point', id: 'e', x: 1, y: 5 },
        { kind: 'line', id: 'l', p1: 's', p2: 'e' },
        { kind: 'circle', id: 'k', center: 'o', radius: 7 },
      ],
      [],
    );
    if (!r.ok) expect.fail(`invalid test sketch: ${JSON.stringify(r.error)}`);
    const data = r.value;
    const points = pointsById(data);
    expect([...points.keys()]).toEqual(['o', 's', 'e']);
    const s = data.entities[1];
    expect(s?.kind).toBe('point');
    expect(s !== undefined && points.get(s.id)).toBe(s);
  });
});
