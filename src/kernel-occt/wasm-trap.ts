// Recognising a WASM trap (spec 06, Errors; Q055). Internal to kernel-occt.

/**
 * True for a WebAssembly.RuntimeError: the WASM machine itself failed (trap, `unreachable`,
 * stack overflow, out of memory, function signature mismatch), so the kernel's memory may be
 * corrupted. Not an OCCT exception (WebAssembly.Exception), which is controlled.
 *
 * The constructor is looked up at run time: the test project has no lib DOM, so
 * WebAssembly.RuntimeError is not a declared value there (as with WebAssembly.Exception).
 */
export function isWasmTrap(e: unknown): e is Error {
  const wasm: unknown = Reflect.get(globalThis, 'WebAssembly');
  if (typeof wasm !== 'object' || wasm === null) return false;
  const runtimeError: unknown = Reflect.get(wasm, 'RuntimeError');
  return typeof runtimeError === 'function' && e instanceof runtimeError;
}
