import { describe, expect, it } from 'vitest';
import { aWasmTrap } from './testing';
import { isWasmTrap } from './wasm-trap';

// Recognising a WASM trap (spec 06, Errors; Q055; M19.1): what is fatal for the kernel and
// what is an ordinary error.

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

describe('isWasmTrap', () => {
  it('is true for a WebAssembly.RuntimeError', () => {
    expect(isWasmTrap(aWasmTrap())).toBe(true);
  });

  it('is false for an ordinary error and a thrown non-error', () => {
    expect(isWasmTrap(new Error('boom'))).toBe(false);
    expect(isWasmTrap('boom')).toBe(false);
    expect(isWasmTrap(undefined)).toBe(false);
  });

  it('is true for a stack overflow: a RangeError about the call stack (V8, JavaScriptCore)', () => {
    const overflow = aStackOverflow();
    expect(overflow).toBeInstanceOf(RangeError);
    expect(isWasmTrap(overflow)).toBe(true);
    // The wording of JavaScriptCore, with a full stop.
    expect(isWasmTrap(new RangeError('Maximum call stack size exceeded.'))).toBe(true);
  });

  it('is true for a stack overflow in SpiderMonkey: InternalError "too much recursion"', () => {
    // InternalError exists only in Firefox: an Error with its name stands in for it.
    const error = new Error('too much recursion');
    error.name = 'InternalError';
    expect(isWasmTrap(error)).toBe(true);
  });

  it('is false for any other RangeError (an invalid array length, a number out of range)', () => {
    expect(isWasmTrap(thrownBy(() => new Array<number>(-1)))).toBe(false);
    expect(isWasmTrap(thrownBy(() => (1).toFixed(101)))).toBe(false);
    const other = new Error('out of memory');
    other.name = 'InternalError';
    expect(isWasmTrap(other)).toBe(false);
  });

  it('unwraps a SuppressedError: a trap in the disposal (error) or in the body (suppressed)', () => {
    expect(isWasmTrap(aSuppressedError(new Error('body'), aWasmTrap()))).toBe(true);
    expect(isWasmTrap(aSuppressedError(aWasmTrap(), new Error('dispose')))).toBe(true);
    expect(isWasmTrap(aSuppressedError(aStackOverflow(), new Error('dispose')))).toBe(true);
  });

  it('unwraps nested SuppressedErrors', () => {
    const inner = aSuppressedError(aWasmTrap(), new Error('inner dispose'));
    expect(isWasmTrap(aSuppressedError(inner, new Error('outer dispose')))).toBe(true);
    expect(isWasmTrap(aSuppressedError(new Error('body'), inner))).toBe(true);
  });

  it('is false for a SuppressedError without a trap inside', () => {
    expect(isWasmTrap(aSuppressedError(new Error('body'), new Error('dispose')))).toBe(false);
  });

  it('unwraps the SuppressedError of a transpiled `using` (a plain Error named SuppressedError)', () => {
    // Where SuppressedError is missing, the helper of the transpiler builds a plain Error with
    // the name and the two properties instead.
    const error = Object.assign(new Error('suppressed'), {
      name: 'SuppressedError',
      error: new Error('dispose'),
      suppressed: aWasmTrap(),
    });
    expect(isWasmTrap(error)).toBe(true);
  });
});
