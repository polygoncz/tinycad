// Programmer-error checks. Use Result for failures the caller is expected to handle.

export function assert(cond: unknown, msg = 'Assertion failed'): asserts cond {
  if (!cond) throw new Error(msg);
}

// Place in the default branch of a switch: compiles only if every case is handled.
export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${String(x)}`);
}
