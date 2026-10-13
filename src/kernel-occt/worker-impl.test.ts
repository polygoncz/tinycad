import { afterEach, describe, expect, it } from 'vitest';
import { createRpcClient, serveRpc } from '@/core';
import { kernelErrorCode, validateMeshData, type GeometryKernel, type MeshData } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import type { OcctKernelProtocol } from './protocol';
import { createOcctWorkerImpl } from './worker-impl';

// The worker side of the OCCT kernel served over a MessageChannel in Node, without a Worker.
// A FakeKernel stands in for OcctKernelImpl: what is tested here is waiting for the
// initialisation, its failure and the transfer of mesh buffers, not OCCT itself.

const ports: MessagePort[] = [];

afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

function connect(init: Promise<GeometryKernel>) {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  serveRpc<OcctKernelProtocol>(port2, createOcctWorkerImpl(init));
  return createRpcClient<OcctKernelProtocol>(port1);
}

/** A promise settled from outside, standing in for the OCCT initialisation. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const BOX = { origin: [0, 0, 0], size: [1, 2, 3] } as const;
const QUALITY = { linearDeflection: 0.1, angularDeflection: 0.5 };

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => expect.fail('Expected the call to reject'),
    (e: unknown) => e,
  );
}

describe('OCCT worker implementation', () => {
  it('a call made before the initialisation finishes waits for it and succeeds', async () => {
    const init = deferred<GeometryKernel>();
    const rpc = connect(init.promise);
    let settled = false;
    const ready = rpc.call('ready').finally(() => {
      settled = true;
    });
    const created = rpc.call('makeBox', BOX);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    init.resolve(createFakeKernel());
    await expect(ready).resolves.toBeUndefined();
    const { shape } = await created;
    await expect(rpc.call('boundingBox', shape)).resolves.toEqual({
      min: [0, 0, 0],
      max: [1, 2, 3],
    });
  });

  it('a failed initialisation rejects ready and every other call with internal', async () => {
    const init = deferred<GeometryKernel>();
    const rpc = connect(init.promise);
    init.reject(new Error('wasm not found'));
    for (const call of [rpc.call('ready'), rpc.call('makeBox', BOX), rpc.call('liveHandleCount')]) {
      const e = await rejection(call);
      expect(kernelErrorCode(e)).toBe('internal');
      expect(e).toBeInstanceOf(Error);
      expect(e instanceof Error ? e.message : '').toContain('wasm not found');
    }
  });

  it('a failed initialisation nobody asks about is not an unhandled rejection', async () => {
    // Vitest fails the run on an unhandled rejection, so this test only has to create it.
    connect(Promise.reject(new Error('wasm not found')));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it('a kernel error arrives with a code kernelErrorCode reads', async () => {
    const rpc = connect(Promise.resolve(createFakeKernel()));
    const { shape } = await rpc.call('makeBox', BOX);
    await rpc.call('release', [shape]);
    expect(kernelErrorCode(await rejection(rpc.call('boundingBox', shape)))).toBe('unknown-handle');
    expect(kernelErrorCode(await rejection(rpc.call('makeBox', { ...BOX, size: [0, 1, 1] })))).toBe(
      'invalid-input',
    );
  });

  it('tessellate transfers the mesh buffers: the worker side loses them', async () => {
    const fake = createFakeKernel();
    let sent: MeshData | undefined;
    const spying: GeometryKernel = {
      makeBox: (p) => fake.makeBox(p),
      boundingBox: (s) => fake.boundingBox(s),
      release: (h) => fake.release(h),
      liveHandleCount: () => fake.liveHandleCount(),
      tessellate: async (s, q) => {
        sent = await fake.tessellate(s, q);
        return sent;
      },
    };
    const rpc = connect(Promise.resolve(spying));
    const { shape } = await rpc.call('makeBox', BOX);
    const mesh = await rpc.call('tessellate', shape, QUALITY);

    expect(validateMeshData(mesh)).toEqual([]);
    expect(mesh.indices.length).toBeGreaterThan(0);
    if (sent === undefined) expect.fail('tessellate was not called on the kernel');
    const fields = [
      'positions',
      'normals',
      'indices',
      'faceRanges',
      'edgePositions',
      'edgeRanges',
    ] as const;
    for (const field of fields) {
      expect(sent[field].buffer.byteLength, `${field} on the worker side`).toBe(0);
    }
  });
});
