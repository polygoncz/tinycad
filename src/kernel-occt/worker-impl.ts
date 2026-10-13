import { transfer, type RpcImpl } from '@/core';
import { createKernelError, type GeometryKernel, type MeshData } from '@/kernel';
import type { OcctKernelProtocol } from './protocol';
import { isWasmTrap } from './wasm-trap';

// Worker side of the OCCT kernel (spec 06, "Start workeru a ready"). serveRpc gets this
// implementation synchronously at worker start, while OCCT is still loading: every method
// first waits for the kernel. Internal to kernel-occt.

/**
 * Serves `init` – the kernel being initialised (in the worker an OcctKernelImpl over the
 * loaded OCCT module). If the initialisation fails, `ready` and every other call reject with
 * 'internal' and the reason, instead of an uncaught exception in the worker.
 *
 * A WASM trap during a call is fatal (spec 06, Chyby; Q055): `onFatal` gets its message
 * before the call is answered with the error, so the client fails everything with
 * 'disconnected' first. The kernel's memory may be corrupted, so after a trap no call reaches
 * the kernel any more – each rejects with 'internal' "OCCT crashed: …".
 */
export function createOcctWorkerImpl(
  init: Promise<GeometryKernel>,
  onFatal: (message: string) => void,
): RpcImpl<OcctKernelProtocol> {
  const kernel = init.catch((e: unknown) => {
    const reason = e instanceof Error ? e.message : String(e);
    throw createKernelError('internal', `OCCT initialisation failed: ${reason}`);
  });
  // Marks the failure as handled: until a call asks, nobody awaits it, and an unhandled
  // rejection would be reported in the worker. Every later await still rejects.
  kernel.catch(() => undefined);

  let crashed: Error | undefined;

  /** Runs `call` on the initialised kernel; a trap ends the kernel and is reported once. */
  async function onKernel<T>(call: (k: GeometryKernel) => Promise<T>): Promise<T> {
    const k = await kernel;
    if (crashed) throw crashed;
    try {
      return await call(k);
    } catch (e) {
      if (isWasmTrap(e)) {
        crashed = createKernelError('internal', `OCCT crashed: ${e.message}`);
        onFatal(e.message);
      }
      throw e;
    }
  }

  return {
    ready: async () => {
      await kernel;
    },
    makeBox: (p) => onKernel((k) => k.makeBox(p)),
    tessellate: async (shape, q) => {
      const mesh = await onKernel((k) => k.tessellate(shape, q));
      // The kernel returns new buffers every call (spec 06), so the worker can give them away.
      return transfer(mesh, meshBuffers(mesh));
    },
    boundingBox: (shape) => onKernel((k) => k.boundingBox(shape)),
    release: (handles) => onKernel((k) => k.release(handles)),
    liveHandleCount: () => onKernel((k) => k.liveHandleCount()),
  };
}

/**
 * The buffers of a mesh, one per array – each array has its own (spec 06, Síť pro vykreslení).
 * MeshData types them as plain ArrayBuffer, so all six can be transferred.
 */
function meshBuffers(mesh: MeshData): ArrayBuffer[] {
  return [
    mesh.positions.buffer,
    mesh.normals.buffer,
    mesh.indices.buffer,
    mesh.faceRanges.buffer,
    mesh.edgePositions.buffer,
    mesh.edgeRanges.buffer,
  ];
}
