import type { Disposable } from '../disposable';
import { RpcError } from './error';
import {
  isRpcResponse,
  listen,
  type MessageEndpoint,
  type RpcProtocol,
  type RpcRequest,
} from './messages';

export interface RpcClient<P extends RpcProtocol<P>> extends Disposable {
  // An explicit call() instead of a Proxy (client.method()): a Proxy answers every
  // property, including `then`, so `await`ing the client itself would hang.
  call<K extends keyof P & string>(method: K, ...args: P[K]['args']): Promise<P[K]['result']>;
  /** The connection is dead: rejects pending and all later calls with RpcError('disconnected', message). */
  failAll(message: string): void;
  /** Same as failAll('RPC client disposed'). */
  dispose(): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: RpcError): void;
}

export function createRpcClient<P extends RpcProtocol<P>>(ep: MessageEndpoint): RpcClient<P> {
  let nextId = 1;
  const pending = new Map<number, Pending>();
  // Set once by failAll; the first message wins (Q037).
  let disconnected: RpcError | undefined;

  listen(ep, (data) => {
    if (!isRpcResponse(data)) return;
    // After failAll the map is empty, so late responses fall through here.
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.ok) p.resolve(data.value);
    else p.reject(new RpcError(data.error.code, data.error.message));
  });

  function failAll(message: string): void {
    if (disconnected) return;
    const error = new RpcError('disconnected', message);
    disconnected = error;
    const waiting = [...pending.values()];
    pending.clear();
    for (const p of waiting) p.reject(error);
  }

  return {
    call(method, ...args) {
      if (disconnected) return Promise.reject(disconnected);
      const id = nextId++;
      const request: RpcRequest = { id, method, args };
      return new Promise((resolve, reject) => {
        // Unchecked: the value comes from a server implementing the same protocol P.
        pending.set(id, { resolve, reject });
        try {
          ep.postMessage(request, []);
        } catch (e) {
          // Arguments that cannot be cloned: fail this call, not the whole client.
          pending.delete(id);
          reject(new RpcError('unserializable', e instanceof Error ? e.message : String(e)));
        }
      });
    },
    failAll,
    dispose: () => {
      failAll('RPC client disposed');
    },
  };
}
