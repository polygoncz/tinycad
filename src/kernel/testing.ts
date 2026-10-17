// Test-only entry point of kernel: reading the code of a kernel error the client side of the
// kernel (remote) rejects with. No production code reads it (the review after M47); dependency-
// cruiser allows importing it only from tests.

import { KERNEL_ERROR_CODES } from './errors';
import type { KernelErrorCode } from './errors';

/** Code of a kernel error, or undefined for any other error. Works in memory and over RPC. */
export function kernelErrorCode(e: unknown): KernelErrorCode | undefined {
  if (typeof e !== 'object' || e === null || !('code' in e)) return undefined;
  const { code } = e;
  return KERNEL_ERROR_CODES.find((c) => c === code);
}
