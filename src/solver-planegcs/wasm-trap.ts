// Recognising a WASM abort (ADR 0016, "OOM"). Internal to solver-planegcs; the same check as in
// kernel-occt, which another adapter must not import.

/**
 * True for a WebAssembly.RuntimeError: the WASM machine itself failed (abort, out of memory,
 * trap), so the module instance is dead and must be discarded.
 *
 * The constructor is looked up at run time: the test project has no lib DOM, so
 * WebAssembly.RuntimeError is not a declared value there.
 */
export function isWasmTrap(e: unknown): e is Error {
  const wasm: unknown = Reflect.get(globalThis, 'WebAssembly');
  if (typeof wasm !== 'object' || wasm === null) return false;
  const runtimeError: unknown = Reflect.get(wasm, 'RuntimeError');
  return typeof runtimeError === 'function' && e instanceof runtimeError;
}
