// A failed RPC of SessionService or DocumentService → RemoteError (spec 14 "Chyby",
// errors.proto): the gRPC code says what the client may do about it, the reason of the
// ErrorDetail says which domain error it is (what the UI shows). The UI translates `reason` and
// `issues`, never the text of the message (ADR 0014).

import { Code, ConnectError } from '@connectrpc/connect';
import type { ParamIssue } from '@/document';
import { ErrorDetailSchema, ErrorReason } from '@/protocol';
import type { ParamIssue as ProtoParamIssue } from '@/protocol';

/** The canonical name of a gRPC status code (google.rpc.Code), without OK. */
export type RemoteErrorCode =
  | 'CANCELLED'
  | 'UNKNOWN'
  | 'INVALID_ARGUMENT'
  | 'DEADLINE_EXCEEDED'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'PERMISSION_DENIED'
  | 'RESOURCE_EXHAUSTED'
  | 'FAILED_PRECONDITION'
  | 'ABORTED'
  | 'OUT_OF_RANGE'
  | 'UNIMPLEMENTED'
  | 'INTERNAL'
  | 'UNAVAILABLE'
  | 'DATA_LOSS'
  | 'UNAUTHENTICATED';

/** The name of an ErrorReason of errors.proto without the prefix ERROR_REASON_. */
export type RemoteErrorReason =
  | 'UNSPECIFIED'
  | 'INVALID_OPERATION'
  | 'UNKNOWN_TARGET'
  | 'READ_ONLY'
  | 'TRANSACTION_OPEN'
  | 'NO_TRANSACTION'
  | 'NOTHING_TO_UNDO'
  | 'NOTHING_TO_REDO'
  | 'OPERATION_ID_REUSED'
  | 'SKETCH_NOT_SOLVED'
  | 'SESSION_NOT_FOUND'
  | 'DOCUMENT_NOT_FOUND'
  | 'INVALID_DOCUMENT'
  | 'KERNEL_INVALID_INPUT'
  | 'KERNEL_OPERATION_FAILED'
  | 'KERNEL_INTERNAL'
  | 'STORAGE'
  | 'DOCUMENT_OPEN';

export interface RemoteErrorInit {
  readonly code: RemoteErrorCode;
  /** Default 'UNSPECIFIED'. */
  readonly reason?: RemoteErrorReason;
  /** Default '' (not known). */
  readonly path?: string;
  /** Default none. */
  readonly issues?: readonly ParamIssue[];
  /** Technical text for the console only. */
  readonly message: string;
  readonly cause?: unknown;
}

/** A failed call of the core, as the rest of the client sees it (spec 14 "Chyby"). */
export class RemoteError extends Error {
  readonly code: RemoteErrorCode;
  readonly reason: RemoteErrorReason;
  /** Path in the request that is wrong ('op.set_params.feature_id'); '' when not known. */
  readonly path: string;
  /** Translatable problems (INVALID_OPERATION, SKETCH_NOT_SOLVED, INVALID_DOCUMENT). */
  readonly issues: readonly ParamIssue[];

  constructor(init: RemoteErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'RemoteError';
    this.code = init.code;
    this.reason = init.reason ?? 'UNSPECIFIED';
    this.path = init.path ?? '';
    this.issues = Object.freeze([...(init.issues ?? [])]);
  }
}

/** The values of ErrorReason this client knows (the type ErrorReason also admits unknown ones). */
type KnownErrorReason = (typeof ErrorReason)[keyof typeof ErrorReason];

// Record over the enum: a reason added to errors.proto without a name here is a type error.
const REASON_NAMES: Readonly<Record<KnownErrorReason, RemoteErrorReason>> = Object.freeze({
  [ErrorReason.UNSPECIFIED]: 'UNSPECIFIED',
  [ErrorReason.INVALID_OPERATION]: 'INVALID_OPERATION',
  [ErrorReason.UNKNOWN_TARGET]: 'UNKNOWN_TARGET',
  [ErrorReason.READ_ONLY]: 'READ_ONLY',
  [ErrorReason.TRANSACTION_OPEN]: 'TRANSACTION_OPEN',
  [ErrorReason.NO_TRANSACTION]: 'NO_TRANSACTION',
  [ErrorReason.NOTHING_TO_UNDO]: 'NOTHING_TO_UNDO',
  [ErrorReason.NOTHING_TO_REDO]: 'NOTHING_TO_REDO',
  [ErrorReason.OPERATION_ID_REUSED]: 'OPERATION_ID_REUSED',
  [ErrorReason.SKETCH_NOT_SOLVED]: 'SKETCH_NOT_SOLVED',
  [ErrorReason.SESSION_NOT_FOUND]: 'SESSION_NOT_FOUND',
  [ErrorReason.DOCUMENT_NOT_FOUND]: 'DOCUMENT_NOT_FOUND',
  [ErrorReason.INVALID_DOCUMENT]: 'INVALID_DOCUMENT',
  [ErrorReason.KERNEL_INVALID_INPUT]: 'KERNEL_INVALID_INPUT',
  [ErrorReason.KERNEL_OPERATION_FAILED]: 'KERNEL_OPERATION_FAILED',
  [ErrorReason.KERNEL_INTERNAL]: 'KERNEL_INTERNAL',
  [ErrorReason.STORAGE]: 'STORAGE',
  [ErrorReason.DOCUMENT_OPEN]: 'DOCUMENT_OPEN',
});

const CODE_NAMES: Readonly<Record<Code, RemoteErrorCode>> = Object.freeze({
  [Code.Canceled]: 'CANCELLED',
  [Code.Unknown]: 'UNKNOWN',
  [Code.InvalidArgument]: 'INVALID_ARGUMENT',
  [Code.DeadlineExceeded]: 'DEADLINE_EXCEEDED',
  [Code.NotFound]: 'NOT_FOUND',
  [Code.AlreadyExists]: 'ALREADY_EXISTS',
  [Code.PermissionDenied]: 'PERMISSION_DENIED',
  [Code.ResourceExhausted]: 'RESOURCE_EXHAUSTED',
  [Code.FailedPrecondition]: 'FAILED_PRECONDITION',
  [Code.Aborted]: 'ABORTED',
  [Code.OutOfRange]: 'OUT_OF_RANGE',
  [Code.Unimplemented]: 'UNIMPLEMENTED',
  [Code.Internal]: 'INTERNAL',
  [Code.Unavailable]: 'UNAVAILABLE',
  [Code.DataLoss]: 'DATA_LOSS',
  [Code.Unauthenticated]: 'UNAUTHENTICATED',
});

/**
 * Any failure of a call → RemoteError. A RemoteError stays itself; anything else goes through
 * ConnectError.from (an Error that is no ConnectError is UNKNOWN). The first ErrorDetail gives
 * reason, path and issues; without one the reason is 'UNSPECIFIED'. A reason this client does not
 * know (a newer server) is 'UNSPECIFIED' too. The ConnectError stays as the cause.
 */
export function toRemoteError(e: unknown): RemoteError {
  if (e instanceof RemoteError) return e;
  const error = ConnectError.from(e);
  const detail = error.findDetails(ErrorDetailSchema)[0];
  return new RemoteError({
    code: CODE_NAMES[error.code],
    reason: detail === undefined ? 'UNSPECIFIED' : reasonName(detail.reason),
    path: detail?.path ?? '',
    issues: detail?.issues.map(issueFromProto) ?? [],
    message: error.message,
    cause: error,
  });
}

/** The call may be repeated with the same operation_id (spec 14 "Chyby"). */
export function isRetryable(e: unknown): boolean {
  const { code } = toRemoteError(e);
  return code === 'UNAVAILABLE' || code === 'DEADLINE_EXCEEDED';
}

/** A ParamIssue of common.proto → ParamIssue of document; `params` only when there are values. */
export function issueFromProto(issue: ProtoParamIssue): ParamIssue {
  const params: Record<string, string | number> = {};
  for (const [key, { value }] of Object.entries(issue.values)) {
    if (value.case !== undefined) params[key] = value.value;
  }
  return Object.freeze({
    param: issue.param,
    code: issue.code,
    ...(Object.keys(params).length > 0 ? { params: Object.freeze(params) } : {}),
  });
}

function reasonName(reason: ErrorReason): RemoteErrorReason {
  // An open enum on the wire: a value of a newer server is no key of the record.
  const names: Readonly<Record<number, RemoteErrorReason | undefined>> = REASON_NAMES;
  return names[reason] ?? 'UNSPECIFIED';
}

/**
 * Runs the decoding of an answer of the core; any failure inside (a message a correct server never
 * sends) becomes a RemoteError INTERNAL about the `what`, with the failure as the cause.
 */
export function decoding<T>(what: string, decode: () => T): T {
  try {
    return decode();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new RemoteError({
      code: 'INTERNAL',
      message: `The core answered a broken ${what}: ${detail}`,
      cause: e,
    });
  }
}
