import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRpcClient, RpcError, serveRpc } from '@/core';
import { kernelErrorCode, validateMeshData, type GeometryKernel } from '@/kernel';
import { describeGeometryKernelContract } from '@/kernel/testing';
import { createOcctKernelClient } from './client';
import { loadOcct, type Occt } from './occt';
import { OcctKernelImpl } from './occt-kernel-impl';
import type { OcctKernelProtocol } from './protocol';
import { createOcctWorkerImpl } from './worker-impl';

// The main-thread client of the OCCT kernel against the worker implementation over a
// MessageChannel in Node, without a Worker: what crosses the boundary (results, transferred
// meshes, error codes) and what happens when the connection dies.

const ports: MessagePort[] = [];

afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

function connect(init: Promise<GeometryKernel>) {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  serveRpc<OcctKernelProtocol>(port2, createOcctWorkerImpl(init));
  const rpc = createRpcClient<OcctKernelProtocol>(port1);
  return { rpc, kernel: createOcctKernelClient(rpc) };
}

const BOX = { origin: [0, 0, 0], size: [1, 2, 3] } as const;

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

describe('OcctKernelClient', () => {
  it('ready resolves once the kernel is initialised', async () => {
    const { kernel } = connect(Promise.resolve(new OcctKernelImpl(oc)));
    await expect(kernel.ready()).resolves.toBeUndefined();
  });

  it('ready rejects with internal when the initialisation fails', async () => {
    const { kernel } = connect(Promise.reject(new Error('wasm not found')));
    const e = await kernel.ready().then(
      () => expect.fail('Expected ready to reject'),
      (err: unknown) => err,
    );
    expect(kernelErrorCode(e)).toBe('internal');
  });

  it('a mesh arrives whole over the channel', async () => {
    const { kernel } = connect(Promise.resolve(new OcctKernelImpl(oc)));
    const { shape } = await kernel.makeBox(BOX);
    const mesh = await kernel.tessellate(shape, { linearDeflection: 0.1, angularDeflection: 0.5 });
    expect(validateMeshData(mesh)).toEqual([]);
    expect(mesh.faceRanges.length / 3).toBe(6);
  });

  it('a kernel error arrives with a code kernelErrorCode reads', async () => {
    const { kernel } = connect(Promise.resolve(new OcctKernelImpl(oc)));
    const e = await kernel.makeBox({ ...BOX, size: [-1, 1, 1] }).then(
      () => expect.fail('Expected makeBox to reject'),
      (err: unknown) => err,
    );
    expect(kernelErrorCode(e)).toBe('invalid-input');
  });

  it('failAll rejects pending calls with disconnected', async () => {
    // An initialisation that never finishes keeps the calls pending in the worker.
    const { rpc, kernel } = connect(new Promise<GeometryKernel>(() => undefined));
    const pending = [kernel.ready(), kernel.makeBox(BOX), kernel.liveHandleCount()];
    rpc.failAll('worker crashed');
    for (const call of pending) {
      const e = await call.then(
        () => expect.fail('Expected the call to reject'),
        (err: unknown) => err,
      );
      expect(e).toBeInstanceOf(RpcError);
      expect(e).toMatchObject({ code: 'disconnected', message: 'worker crashed' });
      expect(kernelErrorCode(e)).toBeUndefined();
    }
    // A later call fails the same way, without reaching the worker.
    await expect(kernel.liveHandleCount()).rejects.toMatchObject({ code: 'disconnected' });
  });
});

describeGeometryKernelContract('OcctKernelClient over MessageChannel', () =>
  Promise.resolve(connect(Promise.resolve(new OcctKernelImpl(oc))).kernel),
);
