import { describe, expect, it } from 'vitest';
import type { SketchData, SketchEntityId } from '@/sketch/model';
import { parseSketchData } from '@/sketch/parse';
import type { SolveInput, SolveResult } from '@/sketch/solver';
import { createFakeSolver, rectangleData } from '@/sketch/testing';

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
