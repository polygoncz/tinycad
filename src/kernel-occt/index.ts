// Ring 3 – OpenCascade (WASM, worker) adapter of GeometryKernel. Imported only by app.
import { createRpcClient } from '@/core';
import type { Disposable } from '@/core';
import type { GeometryKernel } from '@/kernel';
import { createOcctKernelClient, endOnFatal } from './client';
import type { OcctKernelProtocol } from './protocol';

/**
 * GeometryKernel backed by OCCT in a dedicated worker (spec 06, "Start workeru a ready").
 * Resolves once OCCT is initialised. A failed start terminates the worker and rejects:
 * - the OCCT initialisation fails in the worker → the error from the worker ('internal');
 * - the worker never starts (script not found, error in the script) → onerror → failAll →
 *   'disconnected'.
 * Later, a crashed worker or an undecodable message fails all pending and later calls with
 * 'disconnected' (Q037). So does a WASM trap the worker reports ('OCCT crashed: …', Q055),
 * and the worker is terminated. dispose() does the same and terminates the worker.
 */
export async function createOcctKernel(): Promise<GeometryKernel & Disposable> {
  const worker = new Worker(new URL('./occt.worker.ts', import.meta.url), { type: 'module' });
  const rpc = createRpcClient<OcctKernelProtocol>(worker);
  worker.onerror = (e) => {
    rpc.failAll(`OCCT worker failed: ${e.message}`);
  };
  worker.onmessageerror = () => {
    rpc.failAll('OCCT worker sent a message that could not be deserialized');
  };
  const dispose = (): void => {
    rpc.dispose();
    worker.terminate();
  };
  // A WASM trap is fatal (spec 06, Chyby; Q055): the worker reports it, the kernel is dead.
  endOnFatal(worker, rpc, dispose);

  const client = createOcctKernelClient(rpc);
  try {
    await client.ready();
  } catch (e) {
    dispose();
    throw e;
  }
  // Only the port and dispose go out: `ready` belongs to the start-up.
  return {
    makeBox: (p) => client.makeBox(p),
    makeCylinder: (p) => client.makeCylinder(p),
    transform: (shape, m) => client.transform(shape, m),
    boolean: (op, targets, tools) => client.boolean(op, targets, tools),
    makeFace: (p) => client.makeFace(p),
    extrude: (profile, direction, distance) => client.extrude(profile, direction, distance),
    revolve: (profile, axis, angle) => client.revolve(profile, axis, angle),
    fillet: (shape, edges, radius) => client.fillet(shape, edges, radius),
    chamfer: (shape, edges, distance) => client.chamfer(shape, edges, distance),
    tessellate: (shape, q) => client.tessellate(shape, q),
    exportStep: (shapes) => client.exportStep(shapes),
    boundingBox: (shape) => client.boundingBox(shape),
    topology: (shape) => client.topology(shape),
    release: (handles) => client.release(handles),
    liveHandleCount: () => client.liveHandleCount(),
    dispose,
  };
}
