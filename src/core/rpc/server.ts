import { toErrorData } from './error';
import {
  isRpcRequest,
  listen,
  type MessageEndpoint,
  type RpcProtocol,
  type RpcRequest,
  type RpcResponse,
} from './messages';
import { isTransferred, type Transferred } from './transfer';

type Returned<R> = R | Transferred<R>;

export type RpcImpl<P extends RpcProtocol<P>> = {
  readonly [K in keyof P]: (
    ...args: P[K]['args']
  ) => Returned<P[K]['result']> | Promise<Returned<P[K]['result']>>;
};

export function serveRpc<P extends RpcProtocol<P>>(ep: MessageEndpoint, impl: RpcImpl<P>): void {
  // Requests are handled strictly one after another in order of arrival. A single
  // thread alone does not guarantee that: two async methods would interleave.
  let queue: Promise<void> = Promise.resolve();

  listen(ep, (data) => {
    if (!isRpcRequest(data)) return;
    // handle() reports its own failures; the catch only keeps the queue alive if
    // even the error response cannot be sent (core cannot log, ADR 0009).
    queue = queue.then(() => handle(data)).catch(() => undefined);
  });

  async function handle(req: RpcRequest): Promise<void> {
    let response: RpcResponse;
    let buffers: ArrayBuffer[] = [];
    try {
      const result: unknown = await invoke(req.method, req.args);
      if (isTransferred(result)) {
        response = { id: req.id, ok: true, value: result.value };
        buffers = [...result.buffers];
      } else {
        response = { id: req.id, ok: true, value: result };
      }
    } catch (e) {
      response = { id: req.id, ok: false, error: toErrorData(e) };
    }
    try {
      ep.postMessage(response, buffers);
    } catch (e) {
      // The result cannot be cloned (a function, a class instance, a detached buffer…).
      const message = e instanceof Error ? e.message : String(e);
      ep.postMessage({ id: req.id, ok: false, error: { code: 'unserializable', message } }, []);
    }
  }

  // Looks the method up on the object and its prototype chain, so a class
  // instance works too, but never on Object.prototype (toString, constructor…).
  function invoke(name: string, args: readonly unknown[]): unknown {
    let owner: object | null = impl;
    while (owner !== null && owner !== Object.prototype) {
      if (name !== 'constructor' && Object.hasOwn(owner, name)) {
        const method: unknown = Reflect.get(owner, name);
        if (typeof method !== 'function') break;
        // Called with impl as `this`; arguments come from a client typed against the same protocol.
        return Reflect.apply(method, impl, args);
      }
      const proto: unknown = Object.getPrototypeOf(owner);
      owner = typeof proto === 'object' ? proto : null;
    }
    throw Object.assign(new Error(`Unknown RPC method '${name}'`), { code: 'unknown-method' });
  }
}
