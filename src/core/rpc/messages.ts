import type { RpcErrorData } from './error';

// Protocol = map from method name to its arguments and result. The self-referential
// form accepts interfaces as well as type aliases (see Emitter).
export type RpcProtocol<P> = {
  readonly [K in keyof P]: { readonly args: readonly unknown[]; readonly result: unknown };
};

/**
 * What core needs from a message port. Own structural type instead of the DOM
 * one (ADR 0009, Q022): MessagePort, Worker and the worker global scope all fit.
 */
export interface MessageEndpoint {
  // transfer is required: in the DOM overloads only the options form is optional.
  postMessage(msg: unknown, transfer: ArrayBuffer[]): void;
  addEventListener(type: 'message', fn: (e: { readonly data: unknown }) => void): void;
  /** MessagePort delivers nothing to addEventListener listeners until started. */
  start?(): void;
}

export interface RpcRequest {
  readonly id: number;
  readonly method: string;
  readonly args: readonly unknown[];
}

export type RpcResponse =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: RpcErrorData };

// Messages arrive as unknown; these guards replace casts.

export function isRpcRequest(x: unknown): x is RpcRequest {
  return (
    isRecord(x) &&
    typeof x['id'] === 'number' &&
    typeof x['method'] === 'string' &&
    Array.isArray(x['args'])
  );
}

export function isRpcResponse(x: unknown): x is RpcResponse {
  if (!isRecord(x) || typeof x['id'] !== 'number') return false;
  if (x['ok'] === true) return 'value' in x;
  const error = x['error'];
  return (
    x['ok'] === false &&
    isRecord(error) &&
    typeof error['code'] === 'string' &&
    typeof error['message'] === 'string'
  );
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

export function listen(ep: MessageEndpoint, fn: (data: unknown) => void): void {
  ep.addEventListener('message', (e) => {
    fn(e.data);
  });
  ep.start?.();
}
