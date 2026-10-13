// Ring 3 – the OCCT worker: serves the OCCT GeometryKernel over core/rpc.
import { serveRpc } from '@/core';
import type { MessageEndpoint } from '@/core';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { loadOcct } from './occt';
import { OcctKernelImpl } from './occt-kernel-impl';
import type { OcctKernelProtocol } from './protocol';
import { createOcctWorkerImpl } from './worker-impl';

// tsconfig.app.json types `self` as Window (lib DOM, not WebWorker), whose postMessage wants a
// targetOrigin. The options form exists on both Window and DedicatedWorkerGlobalScope, so this
// small adapter fits MessageEndpoint without a cast or another lib.
const endpoint: MessageEndpoint = {
  postMessage: (msg, transfer) => {
    self.postMessage(msg, { transfer });
  },
  addEventListener: (type, fn) => {
    self.addEventListener(type, fn);
  },
};

// Synchronously at start (spec 06, "Start workeru a ready"): a message arriving before the
// listener is registered would be lost. OCCT loads meanwhile; the calls wait for it.
serveRpc<OcctKernelProtocol>(
  endpoint,
  createOcctWorkerImpl(
    loadOcct({ locateWasm: () => wasmUrl }).then((oc) => new OcctKernelImpl(oc)),
  ),
);
