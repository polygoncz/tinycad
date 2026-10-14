// Test helpers of kernel-occt; only *.test.ts may import this file (also tests/).
import type { GeometryKernel } from '@/kernel';
import { loadOcct } from './occt';
import { OcctKernelImpl } from './occt-kernel-impl';

/**
 * The OCCT kernel in the calling thread, without a worker (spec 06, M13): loadOcct() and an
 * OcctKernelImpl over it, for tests in Node that need real geometry. Every call loads the
 * module again (a few hundred ms); load it once per test file.
 */
export async function createInThreadOcctKernel(): Promise<GeometryKernel> {
  return new OcctKernelImpl(await loadOcct());
}

/**
 * A WebAssembly.RuntimeError like the one a trap throws. Built through the global at run
 * time: the test project has no lib DOM, so the class is not a declared value there.
 */
export function aWasmTrap(message = 'unreachable'): Error {
  const wasm: unknown = Reflect.get(globalThis, 'WebAssembly');
  const runtimeError: unknown =
    typeof wasm === 'object' && wasm !== null ? Reflect.get(wasm, 'RuntimeError') : undefined;
  if (typeof runtimeError !== 'function') throw new Error('WebAssembly.RuntimeError is missing');
  const error: unknown = Reflect.construct(runtimeError, [message]);
  if (!(error instanceof Error)) throw new Error('WebAssembly.RuntimeError is not an Error');
  return error;
}
