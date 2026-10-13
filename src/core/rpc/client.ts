import { RpcError } from './error';
import {
  isRpcResponse,
  listen,
  type MessageEndpoint,
  type RpcProtocol,
  type RpcRequest,
} from './messages';

export interface RpcClient<P extends RpcProtocol<P>> {
  // An explicit call() instead of a Proxy (client.method()): a Proxy answers every
  // property, including `then`, so `await`ing the client itself would hang.
  call<K extends keyof P & string>(method: K, ...args: P[K]['args']): Promise<P[K]['result']>;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: RpcError): void;
}

export function createRpcClient<P extends RpcProtocol<P>>(ep: MessageEndpoint): RpcClient<P> {
  let nextId = 1;
  const pending = new Map<number, Pending>();

  listen(ep, (data) => {
    if (!isRpcResponse(data)) return;
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.ok) p.resolve(data.value);
    else p.reject(new RpcError(data.error.code, data.error.message));
  });

  return {
    call(method, ...args) {
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
  };
}
