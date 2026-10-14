import { afterEach, describe, expect, it } from 'vitest';
import { createRpcClient, mat4, serveRpc } from '@/core';
import { kernelErrorCode, validateMeshData, type GeometryKernel, type MeshData } from '@/kernel';
import { createFakeKernel } from '@/kernel/testing';
import type { OcctKernelProtocol } from './protocol';
import { aWasmTrap } from './testing';
import { createOcctWorkerImpl } from './worker-impl';

// The worker side of the OCCT kernel served over a MessageChannel in Node, without a Worker.
// A FakeKernel stands in for OcctKernelImpl: what is tested here is waiting for the
// initialisation, its failure and the transfer of mesh buffers, not OCCT itself.

const ports: MessagePort[] = [];

afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

function connect(
  init: Promise<GeometryKernel>,
  onFatal: (message: string) => void = () => undefined,
) {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  serveRpc<OcctKernelProtocol>(port2, createOcctWorkerImpl(init, onFatal));
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

  it('forwards makeCylinder, transform and boolean to the kernel', async () => {
    const rpc = connect(Promise.resolve(createFakeKernel()));
    const cylinder = await rpc.call('makeCylinder', {
      base: [0, 0, 0],
      axis: [0, 0, 1],
      radius: 1,
      height: 2,
    });
    await expect(rpc.call('boundingBox', cylinder.shape)).resolves.toEqual({
      min: [-1, -1, 0],
      max: [1, 1, 2],
    });
    const moved = await rpc.call('transform', cylinder.shape, mat4.translation([10, 0, 0]));
    await expect(rpc.call('boundingBox', moved.shape)).resolves.toEqual({
      min: [9, -1, 0],
      max: [11, 1, 2],
    });
    const united = await rpc.call('boolean', 'union', [cylinder.shape], [moved.shape]);
    await expect(rpc.call('boundingBox', united.shape)).resolves.toEqual({
      min: [-1, -1, 0],
      max: [11, 1, 2],
    });
    await expect(rpc.call('liveHandleCount')).resolves.toBe(3);
  });

  it('forwards topology, fillet and chamfer to the kernel (M14)', async () => {
    const fake = createFakeKernel();
    const rpc = connect(Promise.resolve(fake));
    const box = await rpc.call('makeBox', BOX);
    const topology = await rpc.call('topology', box.shape);
    expect(topology.faces).toHaveLength(6);
    expect(topology.vertexCount).toBe(8);
    const filleted = await rpc.call('fillet', box.shape, [0, 1], 0.2);
    const chamfered = await rpc.call('chamfer', box.shape, [2], 0.3);
    expect(filleted.history?.modified).toHaveLength(6);
    expect(chamfered.shape).not.toBe(filleted.shape);
    expect(fake.callCount('topology')).toBe(1);
    expect(fake.callCount('fillet')).toBe(1);
    expect(fake.callCount('chamfer')).toBe(1);
  });

  it('tessellate transfers the mesh buffers: the worker side loses them', async () => {
    const fake = createFakeKernel();
    let sent: MeshData | undefined;
    const spying: GeometryKernel = {
      makeBox: (p) => fake.makeBox(p),
      makeCylinder: (p) => fake.makeCylinder(p),
      transform: (s, m) => fake.transform(s, m),
      boolean: (op, targets, tools) => fake.boolean(op, targets, tools),
      makeFace: (p) => fake.makeFace(p),
      extrude: (s, d, l) => fake.extrude(s, d, l),
      revolve: (s, a, angle) => fake.revolve(s, a, angle),
      boundingBox: (s) => fake.boundingBox(s),
      topology: (s) => fake.topology(s),
      fillet: (s, e, r) => fake.fillet(s, e, r),
      chamfer: (s, e, d) => fake.chamfer(s, e, d),
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

  it('a WASM trap answers the call with an error and reports the crash', async () => {
    const fatal: string[] = [];
    const rpc = connect(Promise.resolve(throwingKernel(() => aWasmTrap('unreachable'))), (m) => {
      fatal.push(m);
    });
    const e = await rejection(rpc.call('makeBox', BOX));
    expect(e).toBeInstanceOf(Error);
    expect(e instanceof Error ? e.message : '').toContain('unreachable');
    expect(fatal).toEqual(['unreachable']);
  });

  it('after a trap the kernel computes nothing more', async () => {
    let makeBoxCalls = 0;
    const rpc = connect(
      Promise.resolve(
        throwingKernel(() => {
          makeBoxCalls++;
          return aWasmTrap('unreachable');
        }),
      ),
    );
    await rejection(rpc.call('makeBox', BOX));
    const e = await rejection(rpc.call('makeBox', BOX));
    expect(e instanceof Error ? e.message : '').toContain('OCCT crashed');
    expect(makeBoxCalls).toBe(1);
  });

  it('an OCCT exception stays internal, reports no crash and the kernel keeps working', async () => {
    const fatal: string[] = [];
    let fail = true;
    const fake = createFakeKernel();
    const kernel: GeometryKernel = {
      ...throwingKernel(() => new Error('Standard_DomainError')),
      makeBox: (p) => {
        if (fail) {
          fail = false;
          return Promise.reject(new Error('Standard_DomainError'));
        }
        return fake.makeBox(p);
      },
    };
    const rpc = connect(Promise.resolve(kernel), (m) => {
      fatal.push(m);
    });
    expect(kernelErrorCode(await rejection(rpc.call('makeBox', BOX)))).toBe('internal');
    await expect(rpc.call('makeBox', BOX)).resolves.toHaveProperty('shape');
    expect(fatal).toEqual([]);
  });
});

/** A kernel whose every call rejects with `error()` – a trap or an ordinary failure. */
function throwingKernel(error: () => Error): GeometryKernel {
  const fail = () => Promise.reject(error());
  return {
    makeBox: fail,
    makeCylinder: fail,
    transform: fail,
    boolean: fail,
    makeFace: fail,
    extrude: fail,
    revolve: fail,
    tessellate: fail,
    boundingBox: fail,
    topology: fail,
    fillet: fail,
    chamfer: fail,
    release: fail,
    liveHandleCount: fail,
  };
}
