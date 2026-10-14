// Recognising a WASM trap (spec 06, Errors; Q055). Internal to kernel-occt.

/**
 * True when the WASM machine itself failed, so the kernel's memory may be corrupted. Not an
 * OCCT exception (WebAssembly.Exception), which is controlled. Fatal are:
 * - a WebAssembly.RuntimeError: trap, `unreachable`, out of memory, function signature
 *   mismatch;
 * - a stack overflow, which the engine throws as its own error (M19.1): a RangeError about the
 *   call stack (V8, JavaScriptCore) or InternalError "too much recursion" (SpiderMonkey). Any
 *   other RangeError (an invalid array length…) is not fatal;
 * - a SuppressedError (from `using`) with a fatal error in `error` or `suppressed`, at any
 *   depth: a trap in the body of a `using` block is otherwise hidden behind the error of the
 *   disposal that followed it.
 *
 * The constructor of RuntimeError is looked up at run time: the test project has no lib DOM,
 * so WebAssembly.RuntimeError is not a declared value there (as with WebAssembly.Exception).
 */
export function isWasmTrap(e: unknown): e is Error {
  return containsFatal(e, new Set());
}

/** Whether `e` or an error suppressed in it is fatal; `seen` guards against a cycle. */
function containsFatal(e: unknown, seen: Set<unknown>): boolean {
  if (seen.has(e)) return false;
  seen.add(e);
  if (isSuppressedError(e)) {
    return containsFatal(e.error, seen) || containsFatal(e.suppressed, seen);
  }
  return isRuntimeError(e) || isStackOverflow(e);
}

function isRuntimeError(e: unknown): boolean {
  const wasm: unknown = Reflect.get(globalThis, 'WebAssembly');
  if (typeof wasm !== 'object' || wasm === null) return false;
  const runtimeError: unknown = Reflect.get(wasm, 'RuntimeError');
  return typeof runtimeError === 'function' && e instanceof runtimeError;
}

function isStackOverflow(e: unknown): boolean {
  if (e instanceof RangeError) return /call stack/i.test(e.message);
  // InternalError exists only in SpiderMonkey, so it is recognised by its name.
  return e instanceof Error && e.name === 'InternalError' && /too much recursion/i.test(e.message);
}

/**
 * A SuppressedError by its shape, not its class: where SuppressedError is missing, the helper
 * that transpiles `using` throws a plain Error with this name and the two properties instead.
 */
function isSuppressedError(e: unknown): e is Error & { error: unknown; suppressed: unknown } {
  return e instanceof Error && e.name === 'SuppressedError' && 'error' in e && 'suppressed' in e;
}
