import { transfer, type RpcImpl } from '@/core';
import { createKernelError, type GeometryKernel, type MeshData } from '@/kernel';
import type { OcctKernelProtocol } from './protocol';

// Worker side of the OCCT kernel (spec 06, "Start workeru a ready"). serveRpc gets this
// implementation synchronously at worker start, while OCCT is still loading: every method
// first waits for the kernel. Internal to kernel-occt.

/**
 * Serves `init` – the kernel being initialised (in the worker an OcctKernelImpl over the
 * loaded OCCT module). If the initialisation fails, `ready` and every other call reject with
 * 'internal' and the reason, instead of an uncaught exception in the worker.
 */
export function createOcctWorkerImpl(init: Promise<GeometryKernel>): RpcImpl<OcctKernelProtocol> {
  const kernel = init.catch((e: unknown) => {
    const reason = e instanceof Error ? e.message : String(e);
    throw createKernelError('internal', `OCCT initialisation failed: ${reason}`);
  });
  // Marks the failure as handled: until a call asks, nobody awaits it, and an unhandled
  // rejection would be reported in the worker. Every later await still rejects.
  kernel.catch(() => undefined);

  return {
    ready: async () => {
      await kernel;
    },
    makeBox: async (p) => (await kernel).makeBox(p),
    tessellate: async (shape, q) => {
      const mesh = await (await kernel).tessellate(shape, q);
      // The kernel returns new buffers every call (spec 06), so the worker can give them away.
      return transfer(mesh, meshBuffers(mesh));
    },
    boundingBox: async (shape) => (await kernel).boundingBox(shape),
    release: async (handles) => (await kernel).release(handles),
    liveHandleCount: async () => (await kernel).liveHandleCount(),
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
