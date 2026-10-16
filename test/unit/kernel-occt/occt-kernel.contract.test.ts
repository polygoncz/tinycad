import { beforeAll } from 'vitest';
import { describeGeometryKernelContract } from '@/kernel/testing';
import { loadOcct, type Occt } from '@/kernel-occt/occt';
import { OcctKernelImpl } from '@/kernel-occt/occt-kernel-impl';

// The GeometryKernel contract suite against the OCCT adapter directly in Node, without a
// worker (Q051). The module is loaded once per file; every test gets a fresh kernel.

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

describeGeometryKernelContract('OcctKernelImpl', () => Promise.resolve(new OcctKernelImpl(oc)), {
  // Until task 2 of M30: the OCCT regions are not implemented yet.
  skipProfileRegions: true,
});
