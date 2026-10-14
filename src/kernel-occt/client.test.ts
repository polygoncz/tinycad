import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRpcClient, RpcError, serveRpc } from '@/core';
import { kernelErrorCode, validateMeshData, type GeometryKernel } from '@/kernel';
import { createFakeKernel, describeGeometryKernelContract } from '@/kernel/testing';
import { createOcctKernelClient, endOnFatal } from './client';
import { loadOcct, type Occt } from './occt';
import { OcctKernelImpl } from './occt-kernel-impl';
import { isOcctFatalNotice, type OcctFatalNotice, type OcctKernelProtocol } from './protocol';
import { aWasmTrap } from './testing';
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
  serveRpc<OcctKernelProtocol>(
    port2,
    createOcctWorkerImpl(init, () => undefined),
  );
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

  it('forwards topology, fillet and chamfer with roles and history intact (M14)', async () => {
    const { kernel } = connect(Promise.resolve(new OcctKernelImpl(oc)));
    const box = await kernel.makeBox(BOX);
    expect(box.roles?.['face:top']).toHaveLength(1);
    const topology = await kernel.topology(box.shape);
    expect(topology.faces).toHaveLength(6);
    const filleted = await kernel.fillet(box.shape, [0], 0.2);
    expect((await kernel.topology(filleted.shape)).faces).toHaveLength(7);
    expect(filleted.history?.generated.some((l) => l.from.type === 'edge')).toBe(true);
    const chamfered = await kernel.chamfer(box.shape, [0], 0.2);
    expect((await kernel.topology(chamfered.shape)).faces).toHaveLength(7);
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

describe('endOnFatal', () => {
  /** Wired like createOcctKernel and occt.worker.ts, with `kernel` in the worker. */
  function connectWatched(kernel: GeometryKernel) {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    const reportFatal = (message: string): void => {
      const notice: OcctFatalNotice = { type: 'fatal', message };
      port2.postMessage(notice);
    };
    serveRpc<OcctKernelProtocol>(port2, createOcctWorkerImpl(Promise.resolve(kernel), reportFatal));
    const rpc = createRpcClient<OcctKernelProtocol>(port1);
    const terminated = { count: 0 };
    endOnFatal(port1, rpc, () => {
      terminated.count++;
      rpc.dispose();
    });
    return { kernel: createOcctKernelClient(rpc), terminated };
  }

  /** A fake kernel whose makeBox traps and whose liveHandleCount is slow. */
  function trappingKernel(): GeometryKernel {
    const fake = createFakeKernel();
    return {
      makeBox: () => Promise.reject(aWasmTrap('unreachable')),
      makeCylinder: (p) => fake.makeCylinder(p),
      transform: (s, m) => fake.transform(s, m),
      boolean: (op, targets, tools) => fake.boolean(op, targets, tools),
      makeFace: (p) => fake.makeFace(p),
      extrude: (s, d, l) => fake.extrude(s, d, l),
      revolve: (s, a, angle) => fake.revolve(s, a, angle),
      tessellate: (s, q) => fake.tessellate(s, q),
      boundingBox: (s) => fake.boundingBox(s),
      topology: (s) => fake.topology(s),
      fillet: (s, e, r) => fake.fillet(s, e, r),
      chamfer: (s, e, d) => fake.chamfer(s, e, d),
      release: (h) => fake.release(h),
      liveHandleCount: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve(0);
          }, 50),
        ),
    };
  }

  it('a WASM trap fails the trapping, pending and later calls with disconnected', async () => {
    const { kernel, terminated } = connectWatched(trappingKernel());
    const calls = [kernel.makeBox(BOX), kernel.liveHandleCount(), kernel.liveHandleCount()];
    for (const call of calls) {
      const e = await call.then(
        () => expect.fail('Expected the call to reject'),
        (err: unknown) => err,
      );
      expect(e).toBeInstanceOf(RpcError);
      expect(e).toMatchObject({ code: 'disconnected', message: 'OCCT crashed: unreachable' });
    }
    await expect(kernel.liveHandleCount()).rejects.toMatchObject({
      code: 'disconnected',
      message: 'OCCT crashed: unreachable',
    });
    expect(terminated.count).toBe(1);
  });

  it('an ordinary kernel error keeps the connection', async () => {
    const { kernel, terminated } = connectWatched(createFakeKernel());
    const e = await kernel.makeBox({ ...BOX, size: [0, 1, 1] }).then(
      () => expect.fail('Expected makeBox to reject'),
      (err: unknown) => err,
    );
    expect(kernelErrorCode(e)).toBe('invalid-input');
    await expect(kernel.liveHandleCount()).resolves.toBe(0);
    expect(terminated.count).toBe(0);
  });

  it('isOcctFatalNotice accepts only the fatal notice, not RPC responses', () => {
    expect(isOcctFatalNotice({ type: 'fatal', message: 'unreachable' })).toBe(true);
    expect(isOcctFatalNotice({ type: 'fatal' })).toBe(false);
    expect(isOcctFatalNotice({ id: 1, ok: true, value: 0 })).toBe(false);
    expect(isOcctFatalNotice(null)).toBe(false);
  });
});

describeGeometryKernelContract('OcctKernelClient over MessageChannel', () =>
  Promise.resolve(connect(Promise.resolve(new OcctKernelImpl(oc))).kernel),
);
