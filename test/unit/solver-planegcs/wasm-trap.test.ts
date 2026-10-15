import { describe, expect, it } from 'vitest';
import { isWasmTrap } from '@/solver-planegcs/wasm-trap';

// Recognising a WASM abort (ADR 0016, "OOM"; M19.1): the same check as in kernel-occt, so the
// same cases.

/**
 * A WebAssembly.RuntimeError like the one an abort throws. Built through the global at run
 * time: the test project has no lib DOM, so the class is not a declared value there.
 */
function aWasmTrap(): Error {
  const wasm: unknown = Reflect.get(globalThis, 'WebAssembly');
  const runtimeError: unknown =
    typeof wasm === 'object' && wasm !== null ? Reflect.get(wasm, 'RuntimeError') : undefined;
  if (typeof runtimeError !== 'function') throw new Error('WebAssembly.RuntimeError is missing');
  const error: unknown = Reflect.construct(runtimeError, ['unreachable']);
  if (!(error instanceof Error)) throw new Error('WebAssembly.RuntimeError is not an Error');
  return error;
}

/** What `fn` throws; fails the test if it returns. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return expect.fail('Expected a throw');
}

/** A real stack overflow of the JS engine (V8 in Node: a RangeError about the call stack). */
function aStackOverflow(): unknown {
  const recurse = (n: number): number => recurse(n + 1) + 1;
  return thrownBy(() => recurse(0));
}

/**
 * The SuppressedError a `using` block throws when its body throws `body` and the disposal then
 * throws `dispose`: the error of the disposal is `error`, the error of the body `suppressed`.
 */
function aSuppressedError(body: unknown, dispose: unknown): SuppressedError {
  return new SuppressedError(dispose, body, 'An error was suppressed during disposal.');
}

describe('isWasmTrap (planegcs)', () => {
  it('is true for a WebAssembly.RuntimeError, false for an ordinary error', () => {
    expect(isWasmTrap(aWasmTrap())).toBe(true);
    expect(isWasmTrap(new Error('boom'))).toBe(false);
    expect(isWasmTrap('boom')).toBe(false);
  });

  it('is true for a stack overflow: RangeError about the call stack, InternalError "too much recursion"', () => {
    expect(isWasmTrap(aStackOverflow())).toBe(true);
    expect(isWasmTrap(new RangeError('Maximum call stack size exceeded.'))).toBe(true);
    const error = new Error('too much recursion');
    error.name = 'InternalError';
    expect(isWasmTrap(error)).toBe(true);
  });

  it('is false for any other RangeError', () => {
    expect(isWasmTrap(thrownBy(() => new Array<number>(-1)))).toBe(false);
    expect(isWasmTrap(thrownBy(() => (1).toFixed(101)))).toBe(false);
  });

  it('unwraps a SuppressedError, nested ones too', () => {
    expect(isWasmTrap(aSuppressedError(new Error('body'), aWasmTrap()))).toBe(true);
    expect(isWasmTrap(aSuppressedError(aWasmTrap(), new Error('dispose')))).toBe(true);
    const inner = aSuppressedError(aStackOverflow(), new Error('inner dispose'));
    expect(isWasmTrap(aSuppressedError(new Error('body'), inner))).toBe(true);
    expect(isWasmTrap(aSuppressedError(new Error('body'), new Error('dispose')))).toBe(false);
  });

  it('unwraps the SuppressedError of a transpiled `using` (a plain Error named SuppressedError)', () => {
    const error = Object.assign(new Error('suppressed'), {
      name: 'SuppressedError',
      error: aWasmTrap(),
      suppressed: new Error('body'),
    });
    expect(isWasmTrap(error)).toBe(true);
  });
});
