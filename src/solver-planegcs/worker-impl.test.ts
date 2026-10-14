import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSketchData, type SketchData } from '@/sketch';
import { rectangleData } from '@/sketch/testing';
import { loadPlanegcs, type PlanegcsModule } from './planegcs-module';
import { createSolverWorkerImpl } from './worker-impl';

// The worker side of the solver (spec 12 "Řešič vazeb", Worker): lazy loading of the module and
// discarding it after a WASM abort. Real planegcs in Node, without a Worker.

afterEach(() => {
  vi.restoreAllMocks();
});

/** A loader that counts its calls and loads a fresh real module each time. */
function countingLoader() {
  let count = 0;
  return {
    get count() {
      return count;
    },
    load: (): Promise<PlanegcsModule> => {
      count += 1;
      return loadPlanegcs();
    },
  };
}

describe('createSolverWorkerImpl', () => {
  it('loads the module lazily, once', async () => {
    const loader = countingLoader();
    const impl = createSolverWorkerImpl(loader.load);
    expect(loader.count).toBe(0);
    await expect(impl.solve(rectangleData())).resolves.toMatchObject({ status: 'ok', dof: 4 });
    await impl.solve(rectangleData());
    await impl.ready();
    expect(loader.count).toBe(1);
  });

  it('ready loads the module', async () => {
    const loader = countingLoader();
    const impl = createSolverWorkerImpl(loader.load);
    await expect(impl.ready()).resolves.toBeUndefined();
    expect(loader.count).toBe(1);
  });

  it('a failed load rejects the call with the reason', async () => {
    const impl = createSolverWorkerImpl(() => Promise.reject(new Error('wasm not found')));
    await expect(impl.solve(rectangleData())).rejects.toThrow(/wasm not found/);
    await expect(impl.ready()).rejects.toThrow(/wasm not found/);
  });

  it('a failed load is retried by the next call', async () => {
    let attempts = 0;
    const impl = createSolverWorkerImpl(() => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error('flaky')) : loadPlanegcs();
    });
    await expect(impl.solve(rectangleData())).rejects.toThrow(/flaky/);
    await expect(impl.solve(rectangleData())).resolves.toMatchObject({ status: 'ok' });
    expect(attempts).toBe(2);
  });

  it('out of memory fails the solve, the next one loads a new module', async () => {
    const loader = countingLoader();
    const impl = createSolverWorkerImpl(loader.load);
    // Emscripten reports the abort on stderr before throwing.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(impl.solve(manyRectangles(1000))).resolves.toEqual({
      status: 'failed',
      entities: null,
      dof: null,
      conflicting: [],
      redundant: [],
    });
    expect(loader.count).toBe(1);
    await expect(impl.solve(rectangleData())).resolves.toMatchObject({ status: 'ok', dof: 4 });
    expect(loader.count).toBe(2);
  }, 20_000);
});

/** `n` fully defined rectangles side by side: far more unknowns than the WASM memory holds. */
function manyRectangles(n: number): SketchData {
  const parts = Array.from({ length: n }, (_, i) => {
    const r = rectangleData({ x: i * 30, prefix: `r${String(i)}_` });
    const id = (name: string) => `r${String(i)}_${name}`;
    const extra = parseSketchData(r.entities, [
      { kind: 'distance', id: id('W'), a: id('a'), b: id('b'), value: 10 },
      { kind: 'distance', id: id('H'), a: id('b'), b: id('c'), value: 5 },
      { kind: 'fix', id: id('f'), point: id('a') },
    ]);
    if (!extra.ok) throw new Error('manyRectangles');
    return { entities: r.entities, constraints: [...r.constraints, ...extra.value.constraints] };
  });
  return {
    entities: parts.flatMap((p) => p.entities),
    constraints: parts.flatMap((p) => p.constraints),
  };
}
