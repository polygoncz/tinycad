// Test helpers of kernel-occt; only *.test.ts may import this file.

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
