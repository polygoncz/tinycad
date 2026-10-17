import { Code, ConnectError } from '@connectrpc/connect';
import { describe, expect, it } from 'vitest';
import { ErrorDetailSchema, ErrorReason } from '@/protocol';
import { isRetryable, RemoteError, toRemoteError } from '@/remote';
import type { RemoteErrorReason } from '@/remote';

/** A failed RPC as the server sends it: a status with one ErrorDetail. */
function failure(
  code: Code,
  reason: ErrorReason,
  detail: { path?: string; issues?: { param: string; code: string; values?: object }[] } = {},
): ConnectError {
  return new ConnectError('technical text', code, undefined, [
    { desc: ErrorDetailSchema, value: { reason, ...detail } },
  ]);
}

// Every ErrorReason of errors.proto with the name RemoteError.reason carries.
const REASONS: readonly (readonly [ErrorReason, RemoteErrorReason])[] = [
  [ErrorReason.UNSPECIFIED, 'UNSPECIFIED'],
  [ErrorReason.INVALID_OPERATION, 'INVALID_OPERATION'],
  [ErrorReason.UNKNOWN_TARGET, 'UNKNOWN_TARGET'],
  [ErrorReason.READ_ONLY, 'READ_ONLY'],
  [ErrorReason.TRANSACTION_OPEN, 'TRANSACTION_OPEN'],
  [ErrorReason.NO_TRANSACTION, 'NO_TRANSACTION'],
  [ErrorReason.NOTHING_TO_UNDO, 'NOTHING_TO_UNDO'],
  [ErrorReason.NOTHING_TO_REDO, 'NOTHING_TO_REDO'],
  [ErrorReason.OPERATION_ID_REUSED, 'OPERATION_ID_REUSED'],
  [ErrorReason.SKETCH_NOT_SOLVED, 'SKETCH_NOT_SOLVED'],
  [ErrorReason.SESSION_NOT_FOUND, 'SESSION_NOT_FOUND'],
  [ErrorReason.DOCUMENT_NOT_FOUND, 'DOCUMENT_NOT_FOUND'],
  [ErrorReason.INVALID_DOCUMENT, 'INVALID_DOCUMENT'],
  [ErrorReason.KERNEL_INVALID_INPUT, 'KERNEL_INVALID_INPUT'],
  [ErrorReason.KERNEL_OPERATION_FAILED, 'KERNEL_OPERATION_FAILED'],
  [ErrorReason.KERNEL_INTERNAL, 'KERNEL_INTERNAL'],
  [ErrorReason.STORAGE, 'STORAGE'],
  [ErrorReason.DOCUMENT_OPEN, 'DOCUMENT_OPEN'],
];

describe('toRemoteError', () => {
  it('covers every reason of errors.proto', () => {
    const all = Object.values(ErrorReason).filter((v) => typeof v === 'number');
    expect(REASONS.map(([reason]) => reason).toSorted((a, b) => a - b)).toEqual(all);
  });

  it.each(REASONS)('ErrorDetail reason %i → %s', (reason, name) => {
    const error = toRemoteError(failure(Code.FailedPrecondition, reason));
    expect(error).toBeInstanceOf(RemoteError);
    expect(error).toBeInstanceOf(Error);
    expect(error.reason).toBe(name);
    expect(error.code).toBe('FAILED_PRECONDITION');
  });

  it('carries the path and the issues with their values', () => {
    const error = toRemoteError(
      failure(Code.InvalidArgument, ErrorReason.INVALID_DOCUMENT, {
        path: 'studio.features[0].id',
        issues: [
          {
            param: 'width',
            code: 'param.atOrBelowMin',
            values: {
              min: { value: { case: 'number', value: 0 } },
              unit: { value: { case: 'text', value: 'mm' } },
            },
          },
          { param: '', code: 'document.invalid' },
        ],
      }),
    );
    expect(error.code).toBe('INVALID_ARGUMENT');
    expect(error.path).toBe('studio.features[0].id');
    expect(error.issues).toEqual([
      { param: 'width', code: 'param.atOrBelowMin', params: { min: 0, unit: 'mm' } },
      { param: '', code: 'document.invalid' },
    ]);
  });

  it('without a detail has the reason UNSPECIFIED, no path and no issues', () => {
    const error = toRemoteError(new ConnectError('down', Code.Unavailable));
    expect(error.code).toBe('UNAVAILABLE');
    expect(error.reason).toBe('UNSPECIFIED');
    expect(error.path).toBe('');
    expect(error.issues).toEqual([]);
  });

  it('keeps the ConnectError as the cause and its text as the message', () => {
    const cause = new ConnectError('technical text', Code.NotFound);
    const error = toRemoteError(cause);
    expect(error.cause).toBe(cause);
    expect(error.message).toContain('technical text');
  });

  it('a RemoteError stays itself', () => {
    const error = new RemoteError({ code: 'INTERNAL', message: 'broken' });
    expect(toRemoteError(error)).toBe(error);
  });

  it('anything else is UNKNOWN', () => {
    expect(toRemoteError(new Error('boom')).code).toBe('UNKNOWN');
    expect(toRemoteError('boom').code).toBe('UNKNOWN');
  });

  it('a failed fetch is UNAVAILABLE (N86)', () => {
    const failed = new TypeError('Failed to fetch');
    // connect-web wraps the rejection of fetch as UNKNOWN with the TypeError as the cause
    expect(
      toRemoteError(new ConnectError('x', Code.Unknown, undefined, undefined, failed)).code,
    ).toBe('UNAVAILABLE');
    expect(toRemoteError(failed).code).toBe('UNAVAILABLE');
    expect(isRetryable(failed)).toBe(true);
    expect(
      toRemoteError(new ConnectError('x', Code.Unknown, undefined, undefined, new Error())).code,
    ).toBe('UNKNOWN');
  });

  it('an unknown reason of a newer server is UNSPECIFIED', () => {
    const error = toRemoteError(failure(Code.FailedPrecondition, 999 as ErrorReason)); // a value this client does not know
    expect(error.reason).toBe('UNSPECIFIED');
  });

  it('maps every gRPC code to its canonical name', () => {
    const names = [
      [Code.Canceled, 'CANCELLED'],
      [Code.Unknown, 'UNKNOWN'],
      [Code.InvalidArgument, 'INVALID_ARGUMENT'],
      [Code.DeadlineExceeded, 'DEADLINE_EXCEEDED'],
      [Code.NotFound, 'NOT_FOUND'],
      [Code.AlreadyExists, 'ALREADY_EXISTS'],
      [Code.PermissionDenied, 'PERMISSION_DENIED'],
      [Code.ResourceExhausted, 'RESOURCE_EXHAUSTED'],
      [Code.FailedPrecondition, 'FAILED_PRECONDITION'],
      [Code.Aborted, 'ABORTED'],
      [Code.OutOfRange, 'OUT_OF_RANGE'],
      [Code.Unimplemented, 'UNIMPLEMENTED'],
      [Code.Internal, 'INTERNAL'],
      [Code.Unavailable, 'UNAVAILABLE'],
      [Code.DataLoss, 'DATA_LOSS'],
      [Code.Unauthenticated, 'UNAUTHENTICATED'],
    ] as const;
    for (const [code, name] of names) {
      expect(toRemoteError(new ConnectError('x', code)).code).toBe(name);
    }
  });
});

describe('isRetryable', () => {
  it('is true for UNAVAILABLE and DEADLINE_EXCEEDED only', () => {
    expect(isRetryable(new ConnectError('x', Code.Unavailable))).toBe(true);
    expect(isRetryable(new ConnectError('x', Code.DeadlineExceeded))).toBe(true);
    expect(isRetryable(failure(Code.Unavailable, ErrorReason.STORAGE))).toBe(true);
    expect(isRetryable(new ConnectError('x', Code.NotFound))).toBe(false);
    expect(isRetryable(new ConnectError('x', Code.FailedPrecondition))).toBe(false);
    expect(isRetryable(new RemoteError({ code: 'UNAVAILABLE', message: 'x' }))).toBe(true);
    expect(isRetryable(new Error('x'))).toBe(false);
  });
});
