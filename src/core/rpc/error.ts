// Error class stays concrete so callers can use instanceof (ADR 0011 exception).
export class RpcError extends Error {
  override readonly name = 'RpcError';
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Serialized form of an error as it travels over postMessage. */
export interface RpcErrorData {
  readonly code: string;
  readonly message: string;
}

export function toErrorData(e: unknown): RpcErrorData {
  const code = hasStringCode(e) ? e.code : 'internal';
  const message = e instanceof Error ? e.message : String(e);
  return { code, message };
}

function hasStringCode(e: unknown): e is { code: string } {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string';
}
