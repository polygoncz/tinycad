// Kernel errors (spec 06, Q039): recognised by code, not by class, because a class does not
// survive postMessage – over core/rpc the error arrives as an RpcError with the same code.

const KERNEL_ERROR_CODES = [
  'invalid-input',
  'operation-failed',
  'unknown-handle',
  'internal',
] as const;

export type KernelErrorCode = (typeof KERNEL_ERROR_CODES)[number];

/**
 * Rejection of a kernel call. Internal: implementations create it with createKernelError and
 * callers read the code with kernelErrorCode.
 */
class KernelError extends Error {
  override readonly name = 'KernelError';
  readonly code: KernelErrorCode;

  constructor(code: KernelErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Error with a `code` property, for kernel implementations (fake, OCCT). */
export function createKernelError(code: KernelErrorCode, message: string): Error {
  return new KernelError(code, message);
}

/** Code of a kernel error, or undefined for any other error. Works in memory and over RPC. */
export function kernelErrorCode(e: unknown): KernelErrorCode | undefined {
  if (typeof e !== 'object' || e === null || !('code' in e)) return undefined;
  const { code } = e;
  return KERNEL_ERROR_CODES.find((c) => c === code);
}
