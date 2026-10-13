import { beforeAll } from 'vitest';
import { describeGeometryKernelContract } from '@/kernel/testing';
import { loadOcct, type Occt } from './occt';
import { OcctKernelImpl } from './occt-kernel-impl';

// The GeometryKernel contract suite against the OCCT adapter directly in Node, without a
// worker (Q051). The module is loaded once per file; every test gets a fresh kernel.

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

describeGeometryKernelContract('OcctKernelImpl', () => Promise.resolve(new OcctKernelImpl(oc)));
