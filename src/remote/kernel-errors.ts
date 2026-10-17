// A failed GeometryService call → the rejection of a kernel call (spec 14 "GeometryService" and
// "Chyby", errors.proto): an Error from createKernelError, whose `code` is the KernelErrorCode of
// spec 06 the server's kernel reported.

import { Code, ConnectError } from '@connectrpc/connect';
import { createKernelError } from '@/kernel';
import type { KernelErrorCode } from '@/kernel';
import { ErrorDetailSchema, ErrorReason } from '@/protocol';

/**
 * The kernel error of a failed call. The reason of the first ErrorDetail decides
 * (KERNEL_INVALID_INPUT → 'invalid-input', KERNEL_OPERATION_FAILED → 'operation-failed',
 * KERNEL_INTERNAL → 'internal'); without a kernel reason the gRPC code of the errors.proto table
 * does (INVALID_ARGUMENT, FAILED_PRECONDITION, INTERNAL). Anything else – the server or Envoy not
 * reachable (UNAVAILABLE), a timeout, a broken answer – is 'internal': the kernel did not answer,
 * which the caller cannot fix by other input. The ConnectError stays as the cause.
 */
export function kernelErrorOf(e: unknown): Error {
  const error = ConnectError.from(e);
  const code = kernelCodeOf(error);
  const failure = createKernelError(code, `GeometryService: ${error.message}`);
  failure.cause = error;
  return failure;
}

function kernelCodeOf(error: ConnectError): KernelErrorCode {
  const reason = error.findDetails(ErrorDetailSchema)[0]?.reason;
  switch (reason) {
    case ErrorReason.KERNEL_INVALID_INPUT:
      return 'invalid-input';
    case ErrorReason.KERNEL_OPERATION_FAILED:
      return 'operation-failed';
    case ErrorReason.KERNEL_INTERNAL:
      return 'internal';
    default:
      break;
  }
  switch (error.code) {
    case Code.InvalidArgument:
      return 'invalid-input';
    case Code.FailedPrecondition:
      return 'operation-failed';
    default:
      return 'internal';
  }
}
