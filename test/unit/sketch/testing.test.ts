import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core';
import type { Curve2 } from '@/sketch/geometry';
import type { SketchData, SketchEntityId } from '@/sketch/model';
import { parseSketchData } from '@/sketch/parse';
import type { SolveInput, SolveResult } from '@/sketch/solver';
import { createFakeSketchGeometry, createFakeSolver, rectangleData } from '@/sketch/testing';

const pointId = (data: SketchData, id: string): SketchEntityId => {
  const p = data.entities.find((e) => e.id === id);
  if (p === undefined) throw new Error(`no entity ${id}`);
  return p.id;
};

/** Resolves pending microtasks a few times over. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('rectangleData', () => {
  it('is valid data with four points, four lines and four constraints', () => {
    const data = rectangleData();
    expect(parseSketchData(data.entities, data.constraints).ok).toBe(true);
    expect(data.entities.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd', 'ab', 'bc', 'cd', 'da']);
    expect(data.constraints.map((c) => c.kind)).toEqual([
      'horizontal',
      'vertical',
      'horizontal',
      'vertical',
    ]);
  });

  it('puts the points counter-clockwise from [x, y] with prefixed ids', () => {
    const data = rectangleData({ x: 1, y: 2, width: 3, height: 4, prefix: 'r1.' });
    expect(data.entities.slice(0, 4)).toEqual([
      { kind: 'point', id: 'r1.a', x: 1, y: 2 },
      { kind: 'point', id: 'r1.b', x: 4, y: 2 },
      { kind: 'point', id: 'r1.c', x: 4, y: 6 },
      { kind: 'point', id: 'r1.d', x: 1, y: 6 },
    ]);
    expect(data.entities[4]).toEqual({ kind: 'line', id: 'r1.ab', p1: 'r1.a', p2: 'r1.b' });
    expect(data.constraints.every((c) => c.id.startsWith('r1.'))).toBe(true);
    expect(parseSketchData(data.entities, data.constraints).ok).toBe(true);
  });

  it('is frozen', () => {
    const data = rectangleData();
    expect(Object.isFrozen(data)).toBe(true);
    expect(Object.isFrozen(data.entities)).toBe(true);
    expect(Object.isFrozen(data.entities[0])).toBe(true);
  });
});

describe('FakeSolver', () => {
  it('echoes the input with the naive degrees of freedom', async () => {
    const solver = createFakeSolver();
    const data = rectangleData();
    const result = await solver.solve(data);
    // 4 points · 2 − 4 constraints of weight 1.
    expect(result).toEqual({
      status: 'ok',
      entities: data.entities,
      dof: 4,
      conflicting: [],
      redundant: [],
    });
  });

  it('weights coincident and fix by 2, adds circles and subtracts arcs', async () => {
    const r = parseSketchData(
      [
        { kind: 'point', id: 'o', x: 0, y: 0 },
        { kind: 'point', id: 's', x: 1, y: 0 },
        { kind: 'point', id: 'e', x: 0, y: 1 },
        { kind: 'point', id: 'p', x: 0, y: 1 },
        { kind: 'circle', id: 'k', center: 'o', radius: 1 },
        { kind: 'arc', id: 'q', center: 'o', start: 's', end: 'e' },
      ],
      [
        { kind: 'fix', id: 'f', point: 'o' },
        { kind: 'coincident', id: 'c', a: 'e', b: 'p' },
        { kind: 'radius', id: 'r', curve: 'k', value: 1 },
      ],
    );
    if (!r.ok) throw new Error('invalid');
    // 4·2 + 1 − (2 + 2 + 1) − 1 = 3
    expect((await createFakeSolver().solve(r.value)).dof).toBe(3);
  });

  it('weights pointOnCurve, hAlign and vAlign by 1, midpoint by 2', async () => {
    const r = parseSketchData(
      [
        { kind: 'point', id: 'a', x: 0, y: 0 },
        { kind: 'point', id: 'b', x: 10, y: 0 },
        { kind: 'line', id: 'ab', p1: 'a', p2: 'b' },
        { kind: 'point', id: 'm', x: 5, y: 0 },
        { kind: 'point', id: 'p', x: 3, y: 0 },
        { kind: 'point', id: 'q', x: 3, y: 7 },
      ],
      [
        { kind: 'midpoint', id: 'c1', point: 'm', line: 'ab' },
        { kind: 'pointOnCurve', id: 'c2', point: 'p', curve: 'ab' },
        { kind: 'vAlign', id: 'c3', a: 'p', b: 'q' },
        { kind: 'hAlign', id: 'c4', a: 'q', b: 'a' },
      ],
    );
    if (!r.ok) throw new Error('invalid');
    // 5·2 − (2 + 1 + 1 + 1) = 5
    expect((await createFakeSolver().solve(r.value)).dof).toBe(5);
  });

  it('never reports negative degrees of freedom', async () => {
    const data = rectangleData();
    const many = { ...data, constraints: [...data.constraints, ...data.constraints] };
    const fixed = parseSketchData(data.entities, [
      ...data.constraints,
      ...['a', 'b', 'c', 'd'].map((p) => ({ kind: 'fix', id: `f${p}`, point: p })),
    ]);
    if (!fixed.ok) throw new Error('invalid');
    expect((await createFakeSolver().solve(fixed.value)).dof).toBe(0);
    expect((await createFakeSolver().solve(many)).dof).toBe(0);
  });

  it('moves the dragged point to the target', async () => {
    const data = rectangleData();
    const c = pointId(data, 'c');
    const result = await createFakeSolver().solve({ ...data, drag: { point: c, to: [7, 8] } });
    expect(result.entities?.[2]).toEqual({ kind: 'point', id: 'c', x: 7, y: 8 });
    expect(result.entities?.filter((e, i) => e !== data.entities[i])).toHaveLength(1);
    expect(result.dof).toBe(4);
  });

  it('answers asynchronously, in a microtask', async () => {
    const solver = createFakeSolver();
    let done = false;
    const p = solver.solve(rectangleData()).then(() => {
      done = true;
    });
    expect(done).toBe(false);
    await p;
    expect(done).toBe(true);
  });

  it('next overrides fields of the following results, in order', async () => {
    const solver = createFakeSolver();
    const conflict: Partial<SolveResult> = {
      status: 'conflict',
      entities: null,
      conflicting: rectangleData()
        .constraints.slice(0, 1)
        .map((x) => x.id),
    };
    solver.next(conflict);
    solver.next({ dof: 42 });
    const data = rectangleData();
    const first = await solver.solve(data);
    const second = await solver.solve(data);
    const third = await solver.solve(data);
    expect(first).toEqual({ ...conflict, dof: 4, redundant: [] });
    expect(second).toEqual({
      status: 'ok',
      entities: data.entities,
      dof: 42,
      conflicting: [],
      redundant: [],
    });
    expect(third.dof).toBe(4);
  });

  it('records the inputs in calls', async () => {
    const solver = createFakeSolver();
    const a: SolveInput = rectangleData();
    const b: SolveInput = rectangleData({ prefix: 'x' });
    await solver.solve(a);
    await solver.solve(b);
    expect(solver.calls).toEqual([a, b]);
  });

  it('hold delays answers until release, which settles them in order', async () => {
    const solver = createFakeSolver();
    solver.hold();
    const order: number[] = [];
    const p1 = solver.solve(rectangleData()).then(() => order.push(1));
    const p2 = solver.solve(rectangleData()).then(() => order.push(2));
    await flush();
    expect(order).toEqual([]);
    expect(solver.calls).toHaveLength(2);
    solver.release();
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
    // After release answers flow again.
    await expect(solver.solve(rectangleData())).resolves.toMatchObject({ status: 'ok' });
  });

  it('computes a held result from the input at call time', async () => {
    const solver = createFakeSolver();
    solver.hold();
    solver.next({ dof: 7 });
    const p = solver.solve(rectangleData());
    solver.next({ dof: 9 });
    solver.release();
    expect((await p).dof).toBe(7);
  });
});

describe('createFakeSketchGeometry', () => {
  const geometry = createFakeSketchGeometry();
  const line = (id: string, from: Vec2, to: Vec2): Curve2 => ({ kind: 'line', from, to, id });

  it('intersects lines; parameters by spec 12; order a, b, ta', async () => {
    const hits = await geometry.intersections([
      line('h', [0, 0], [10, 0]),
      line('u', [7, -1], [7, 1]),
      line('v', [3, -1], [3, 1]),
    ]);
    expect(hits.map((h) => [h.a, h.b])).toEqual([
      ['h', 'u'],
      ['h', 'v'],
    ]);
    expect(hits[0]?.ta).toBeCloseTo(0.7, 12);
    expect(hits[0]?.tb).toBeCloseTo(0.5, 12);
    expect(hits[1]?.point[0]).toBeCloseTo(3, 12);
  });

  it('reports shared end points and the ends of an overlap', async () => {
    const shared = await geometry.intersections([
      line('a', [0, 0], [1, 0]),
      line('b', [1, 0], [1, 1]),
    ]);
    expect(shared).toEqual([{ a: 'a', b: 'b', point: [1, 0], ta: 1, tb: 0 }]);
    const overlap = await geometry.intersections([
      line('a', [0, 0], [4, 0]),
      line('b', [2, 0], [6, 0]),
    ]);
    expect(overlap.map((h) => [h.point, h.ta, h.tb, h.overlap])).toEqual([
      [[2, 0], 0.5, 0, true],
      [[4, 0], 1, 0.5, true],
    ]);
  });

  it('intersects a line with an arc in two points and touches a circle once', async () => {
    const arc: Curve2 = {
      kind: 'arc',
      center: [0, 0],
      from: [5, 0],
      to: [-5, 0],
      ccw: true,
      id: 'a',
    };
    const hits = await geometry.intersections([arc, line('l', [-10, 3], [10, 3])]);
    const angle = Math.atan2(3, 4);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.ta).toBeCloseTo(angle, 9);
    expect(hits[1]?.ta).toBeCloseTo(Math.PI - angle, 9);
    expect(hits[0]?.tb).toBeCloseTo(0.7, 9);
    expect(hits[1]?.tb).toBeCloseTo(0.3, 9);
    const circle: Curve2 = { kind: 'circle', center: [0, 0], radius: 2, id: 'k' };
    const other: Curve2 = { kind: 'circle', center: [5, 0], radius: 3, id: 'm' };
    const touch = await geometry.intersections([circle, other]);
    expect(touch).toHaveLength(1);
    expect(touch[0]?.ta).toBeCloseTo(0, 9);
    expect(touch[0]?.tb).toBeCloseTo(Math.PI, 9);
  });

  it('gives pieces of lines, arcs and circles (a circle → an arc, past 2π)', async () => {
    const piece = await geometry.segment(line('l', [0, 0], [10, 0]), 0.2, 0.5);
    expect(piece).toEqual({ kind: 'line', from: [2, 0], to: [5, 0], id: 'l' });
    const circle: Curve2 = { kind: 'circle', center: [0, 0], radius: 1, id: 'k' };
    const arc = await geometry.segment(circle, 1.5 * Math.PI, 2.5 * Math.PI);
    expect(arc).toMatchObject({ kind: 'arc', center: [0, 0], ccw: true, id: 'k' });
    if (arc.kind !== 'arc') throw new Error('not an arc');
    expect(arc.from[1]).toBeCloseTo(-1, 12);
    expect(arc.to[1]).toBeCloseTo(1, 12);
    await expect(geometry.segment(line('l', [0, 0], [1, 0]), 0.5, 0.2)).rejects.toThrow();
    await expect(geometry.segment(circle, 1, 1 + 3 * Math.PI)).rejects.toThrow();
  });

  it('rejects splines and curves without an id', async () => {
    const spline: Curve2 = {
      kind: 'bspline',
      degree: 1,
      poles: [
        [0, 0],
        [1, 1],
      ],
      knots: [0, 0, 1, 1],
      id: 's',
    };
    await expect(geometry.intersections([spline])).rejects.toThrow();
    await expect(geometry.segment(spline, 0, 0.5)).rejects.toThrow();
    const anonymous: Curve2 = { kind: 'line', from: [0, 0], to: [1, 0] };
    await expect(geometry.intersections([anonymous])).rejects.toThrow();
  });

  describe('fillet', () => {
    const arc = (id: string, center: Vec2, from: Vec2, to: Vec2): Curve2 => ({
      kind: 'arc',
      center,
      from,
      to,
      ccw: true,
      id,
    });
    const close = (p: Vec2, q: Vec2): void => {
      expect(p[0]).toBeCloseTo(q[0], 9);
      expect(p[1]).toBeCloseTo(q[1], 9);
    };

    it('rounds two perpendicular lines, the centre nearest near', async () => {
      const h = line('h', [0, 0], [10, 0]);
      const v = line('v', [10, 0], [10, 5]);
      const inside = await geometry.fillet(h, v, 1, [9.5, 0.5]);
      close(inside.center, [9, 1]);
      close(inside.pointA, [9, 0]);
      close(inside.pointB, [10, 1]);
      expect(inside.ta).toBeCloseTo(0.9, 12);
      expect(inside.tb).toBeCloseTo(0.2, 12);
      const outside = await geometry.fillet(h, v, 1, [11, -1]);
      close(outside.center, [11, -1]);
      expect(outside.tb).toBeCloseTo(-0.2, 12); // on the extension of v
    });

    it('rounds lines under 60° and lines that do not meet', async () => {
      const h = line('h', [0, 0], [10, 0]);
      const s = line('s', [0, 0], [5, 5 * Math.sqrt(3)]);
      const f = await geometry.fillet(h, s, 1, [2, 0.5]);
      // The centre on the bisector at 30°, 1 from both: (√3, 1).
      close(f.center, [Math.sqrt(3), 1]);
      close(f.pointA, [Math.sqrt(3), 0]);

      const far = await geometry.fillet(h, line('v', [12, 2], [12, 8]), 1, [11, 1]);
      close(far.pointA, [11, 0]);
      close(far.pointB, [12, 1]);
      expect(far.ta).toBeCloseTo(1.1, 12);
      expect(far.tb).toBeCloseTo(-1 / 6, 12);
    });

    it('rounds a line and an arc outside and inside, and two arcs', async () => {
      const l = line('l', [10, -10], [10, 0]);
      const k = arc('k', [10, 10], [10, 0], [20, 10]);
      const out = await geometry.fillet(l, k, 1, [11, -1]);
      expect(out.center[0]).toBeCloseTo(11, 9);
      expect(Math.hypot(out.center[0] - 10, out.center[1] - 10)).toBeCloseTo(11, 9);
      expect(Math.hypot(out.pointB[0] - 10, out.pointB[1] - 10)).toBeCloseTo(10, 9);
      expect(out.ta).toBeGreaterThan(0.9);
      // The parameter on the arc: the angle from its start counter-clockwise.
      expect(out.tb).toBeCloseTo(Math.atan2(1, Math.sqrt(120)), 9);

      const within = await geometry.fillet(l, k, 1, [11, 1]);
      expect(Math.hypot(within.center[0] - 10, within.center[1] - 10)).toBeCloseTo(9, 9);

      const m = arc('m', [30, 10], [20, 10], [30, 0]);
      const two = await geometry.fillet(k, m, 1, [20, 5]);
      expect(Math.hypot(two.center[0] - 10, two.center[1] - 10)).toBeCloseTo(11, 9);
      expect(Math.hypot(two.center[0] - 30, two.center[1] - 10)).toBeCloseTo(11, 9);
    });

    it('rejects a radius too large, parallel lines too far apart, a circle', async () => {
      const a = line('a', [0, 0], [10, 0]);
      const b = line('b', [0, 3], [10, 3]);
      await expect(geometry.fillet(a, b, 1, [5, 1])).rejects.toThrow();
      const half = await geometry.fillet(a, b, 1.5, [12, 1]);
      close(half.center, [12, 1.5]);
      const k = arc('k', [0, 10], [1, 10], [0, 11]);
      await expect(geometry.fillet(a, k, 2, [0, 5])).rejects.toThrow();
      const circle: Curve2 = { kind: 'circle', center: [0, 5], radius: 1, id: 'c' };
      await expect(geometry.fillet(a, circle, 1, [0, 1])).rejects.toThrow();
    });
  });

  describe('offset', () => {
    const rect: Curve2[] = [
      line('ab', [0, 0], [10, 0]),
      line('bc', [10, 0], [10, 5]),
      line('cd', [10, 5], [0, 5]),
      line('da', [0, 5], [0, 0]),
    ];

    it('offsets a closed chain of lines outwards and inwards with sharp corners', async () => {
      expect(await geometry.offset(rect, true, 1)).toEqual([
        { kind: 'line', from: [-1, -1], to: [11, -1], source: 'ab' },
        { kind: 'line', from: [11, -1], to: [11, 6], source: 'bc' },
        { kind: 'line', from: [11, 6], to: [-1, 6], source: 'cd' },
        { kind: 'line', from: [-1, 6], to: [-1, -1], source: 'da' },
      ]);
      const inwards = await geometry.offset(rect, true, -1);
      expect(inwards.map((c) => (c.kind === 'line' ? c.from : null))).toEqual([
        [1, 1],
        [9, 1],
        [9, 4],
        [1, 4],
      ]);
      // A clockwise loop goes outwards too.
      const clockwise = [...rect]
        .reverse()
        .map((c): Curve2 => (c.kind === 'line' ? { ...c, from: c.to, to: c.from } : c));
      const out = await geometry.offset(clockwise, true, 1);
      expect(out[0]).toEqual({ kind: 'line', from: [-1, -1], to: [-1, 6], source: 'da' });
    });

    it('offsets an open chain to the right of its direction, the ends moved', async () => {
      const l = [line('l1', [0, 0], [10, 0]), line('l2', [10, 0], [10, 5])];
      expect(await geometry.offset(l, false, 1)).toEqual([
        { kind: 'line', from: [0, -1], to: [11, -1], source: 'l1' },
        { kind: 'line', from: [11, -1], to: [11, 5], source: 'l2' },
      ]);
      const left = await geometry.offset(l, false, -1);
      expect(left[0]).toEqual({ kind: 'line', from: [0, 1], to: [9, 1], source: 'l1' });
    });

    it('rejects arcs, circles, a zero distance and a vanishing line', async () => {
      const circle: Curve2 = { kind: 'circle', center: [0, 0], radius: 1, id: 'c' };
      await expect(geometry.offset([circle], true, 1)).rejects.toThrow();
      const k: Curve2 = {
        kind: 'arc',
        center: [0, 0],
        from: [1, 0],
        to: [0, 1],
        ccw: true,
        id: 'k',
      };
      await expect(geometry.offset([k], false, 1)).rejects.toThrow();
      await expect(geometry.offset(rect, true, 0)).rejects.toThrow();
      await expect(geometry.offset(rect, true, -3)).rejects.toThrow();
    });
  });
});
