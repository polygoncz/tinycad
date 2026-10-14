import { beforeAll, describe, expect, it } from 'vitest';
import { kernelErrorCode, validateMeshData } from '@/kernel';
import { loadOcct, type Occt } from './occt';
import { OcctKernelImpl } from './occt-kernel-impl';

// What the OCCT adapter does beyond the contract (spec 06, "Testy", M14): fillet and chamfer
// of a box edge – the new face, its history and failures of the algorithm.

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

const QUALITY = { linearDeflection: 0.01, angularDeflection: 0.1 };

/** A box 10 × 10 × 10 and the index of its edge between face:top and face:front. */
async function aBoxEdge(kernel: OcctKernelImpl) {
  const box = await kernel.makeBox({ origin: [0, 0, 0], size: [10, 10, 10] });
  const top = box.roles?.['face:top']?.[0]?.index ?? -1;
  const front = box.roles?.['face:front']?.[0]?.index ?? -1;
  const topology = await kernel.topology(box.shape);
  const pair = [top, front].sort((a, b) => a - b).join();
  const edge = topology.edges.findIndex((e) => e.faces.join() === pair);
  expect(edge).toBeGreaterThanOrEqual(0);
  return { box: box.shape, edge, top, front };
}

async function codeOf(p: Promise<unknown>) {
  return p.then(
    () => expect.fail('Expected the call to reject'),
    (e: unknown) => kernelErrorCode(e),
  );
}

describe('OcctKernelImpl.fillet and chamfer (M14)', () => {
  it('a fillet of a box edge: 7 faces, one generated from the edge, the neighbours modified', async () => {
    const kernel = new OcctKernelImpl(oc);
    const { box, edge, top, front } = await aBoxEdge(kernel);
    const { shape, history } = await kernel.fillet(box, [edge], 2);
    const topology = await kernel.topology(shape);
    expect(topology.faces).toHaveLength(7);
    const fromEdge = history?.generated.filter(
      (l) => l.from.type === 'edge' && l.from.index === edge,
    );
    expect(fromEdge).toHaveLength(1);
    expect(fromEdge?.[0]?.to).toHaveLength(1);
    expect(topology.faces[fromEdge?.[0]?.to[0]?.index ?? -1]?.surface).toBe('cylinder');
    for (const neighbour of [top, front]) {
      const link = history?.modified.find((l) => l.from.index === neighbour);
      expect(link?.to, `face ${String(neighbour)}`).toHaveLength(1);
    }
    expect(history?.deleted).toEqual([]);
    expect(validateMeshData(await kernel.tessellate(shape, QUALITY))).toEqual([]);
  });

  it('a chamfer of a box edge: 7 faces, the new face is planar', async () => {
    const kernel = new OcctKernelImpl(oc);
    const { box, edge } = await aBoxEdge(kernel);
    const { shape, history } = await kernel.chamfer(box, [edge], 2);
    const topology = await kernel.topology(shape);
    expect(topology.faces).toHaveLength(7);
    const fromEdge = history?.generated.find(
      (l) => l.from.type === 'edge' && l.from.index === edge,
    );
    const plane = topology.faces[fromEdge?.to[0]?.index ?? -1]?.plane;
    expect(plane).toBeDefined();
    // Between +Z and −Y: the normal is (0, −1, 1)/√2.
    expect(plane?.normal[1]).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(plane?.normal[2]).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it.each(['fillet', 'chamfer'] as const)('%s of several edges at once works', async (op) => {
    const kernel = new OcctKernelImpl(oc);
    const { box } = await aBoxEdge(kernel);
    const { shape } = await kernel[op](box, [0, 1, 2, 3], 1);
    expect((await kernel.topology(shape)).faces.length).toBeGreaterThan(6);
  });

  it.each(['fillet', 'chamfer'] as const)(
    '%s of size 11 on a box of 10 rejects with operation-failed, no handle',
    async (op) => {
      const kernel = new OcctKernelImpl(oc);
      const { box, edge } = await aBoxEdge(kernel);
      expect(await codeOf(kernel[op](box, [edge], 11))).toBe('operation-failed');
      expect(await kernel.liveHandleCount()).toBe(1);
      // The input stays valid.
      expect((await kernel.topology(box)).faces).toHaveLength(6);
    },
  );

  it('a fillet of a whole cylinder cap edge larger than the radius rejects with operation-failed', async () => {
    const kernel = new OcctKernelImpl(oc);
    const { shape } = await kernel.makeCylinder({
      base: [0, 0, 0],
      axis: [0, 0, 1],
      radius: 1,
      height: 10,
    });
    const topology = await kernel.topology(shape);
    const circle = topology.edges.findIndex((e) => e.faces.length === 2);
    expect(await codeOf(kernel.fillet(shape, [circle], 5))).toBe('operation-failed');
    expect(await kernel.liveHandleCount()).toBe(1);
  });

  it('an edge index of a released shape rejects with unknown-handle', async () => {
    const kernel = new OcctKernelImpl(oc);
    const { box } = await aBoxEdge(kernel);
    await kernel.release([box]);
    expect(await codeOf(kernel.fillet(box, [0], 1))).toBe('unknown-handle');
  });
});
