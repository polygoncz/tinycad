import type { MessageEndpoint, RpcClient } from '@/core';
import type { GeometryKernel } from '@/kernel';
import { isOcctFatalNotice, type OcctKernelProtocol } from './protocol';

/**
 * GeometryKernel on the main thread that forwards every call to the OCCT worker (spec 06,
 * "kernel-occt: architektura adaptéru"). Thin: kernel errors arrive as RpcError with the same
 * code (read with kernelErrorCode) and meshes arrive transferred, so nothing is converted.
 * Takes only `call` of the RPC client (ADR 0011, narrow interfaces): failAll and dispose belong
 * to the owner of the worker (Q037). `ready` waits for the OCCT initialisation in the worker.
 */
export function createOcctKernelClient(
  rpc: Pick<RpcClient<OcctKernelProtocol>, 'call'>,
): GeometryKernel & { ready(): Promise<void> } {
  return {
    ready: () => rpc.call('ready'),
    makeBox: (p) => rpc.call('makeBox', p),
    makeCylinder: (p) => rpc.call('makeCylinder', p),
    transform: (shape, m) => rpc.call('transform', shape, m),
    boolean: (op, targets, tools) => rpc.call('boolean', op, targets, tools),
    makeFace: (p) => rpc.call('makeFace', p),
    tessellate: (shape, q) => rpc.call('tessellate', shape, q),
    boundingBox: (shape) => rpc.call('boundingBox', shape),
    release: (handles) => rpc.call('release', handles),
    liveHandleCount: () => rpc.call('liveHandleCount'),
  };
}

/**
 * Ends the connection when the worker reports a WASM trap (spec 06, Chyby; Q055): fails all
 * pending and later calls with 'disconnected' "OCCT crashed: …", then calls `terminate`.
 * failAll comes first, so its message wins over a failAll inside `terminate`.
 */
export function endOnFatal(
  ep: Pick<MessageEndpoint, 'addEventListener'>,
  rpc: Pick<RpcClient<OcctKernelProtocol>, 'failAll'>,
  terminate: () => void,
): void {
  ep.addEventListener('message', (e) => {
    if (!isOcctFatalNotice(e.data)) return;
    rpc.failAll(`OCCT crashed: ${e.data.message}`);
    terminate();
  });
}
