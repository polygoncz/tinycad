import { describe, expect, it } from 'vitest';
import { RpcError } from '@/core';
import { createKernelError, kernelErrorCode } from '@/kernel/errors';

describe('kernelErrorCode', () => {
  it.each(['invalid-input', 'operation-failed', 'unknown-handle', 'internal'] as const)(
    'reads %s from an error created by createKernelError',
    (code) => {
      expect(kernelErrorCode(createKernelError(code, 'x'))).toBe(code);
    },
  );

  it('reads the code of an RpcError that crossed core/rpc', () => {
    expect(kernelErrorCode(new RpcError('unknown-handle', 'gone'))).toBe('unknown-handle');
  });

  it('reads internal from an RpcError, because internal is also a kernel code', () => {
    expect(kernelErrorCode(new RpcError('internal', 'boom'))).toBe('internal');
  });

  it.each([
    ['an RpcError with a foreign code', new RpcError('disconnected', 'worker died')],
    ['an Error without code', new Error('x')],
    ['a non-string code', { code: 1 }],
    ['a string', 'invalid-input'],
    ['undefined', undefined],
    ['null', null],
  ])('returns undefined for %s', (_, e) => {
    expect(kernelErrorCode(e)).toBeUndefined();
  });
});

describe('createKernelError', () => {
  it('creates an Error with the message and a readable code', () => {
    const e = createKernelError('operation-failed', 'fillet too big');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('fillet too big');
    expect(kernelErrorCode(e)).toBe('operation-failed');
  });
});
