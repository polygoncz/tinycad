// Kernel errors (spec 06, Q039): recognised by code, not by class, because a class does not
// survive postMessage – over core/rpc the error arrives as an RpcError with the same code.

export const KERNEL_ERROR_CODES = [
  'invalid-input',
  'operation-failed',
  'unknown-handle',
  'internal',
] as const;

export type KernelErrorCode = (typeof KERNEL_ERROR_CODES)[number];

/**
 * Rejection of a kernel call. Internal: remote creates it with createKernelError; callers read
 * its `code` (tests with kernelErrorCode of testing.ts).
 */
class KernelError extends Error {
  override readonly name = 'KernelError';
  readonly code: KernelErrorCode;

  constructor(code: KernelErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Error with a `code` property, for the client side of the kernel (remote). */
export function createKernelError(code: KernelErrorCode, message: string): Error {
  return new KernelError(code, message);
}
