// Ring 3 – the solver worker: serves the planegcs ConstraintSolver over core/rpc.
import wasmUrl from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import { serveRpc } from '@/core';
import type { MessageEndpoint } from '@/core';
import { loadPlanegcs } from './planegcs-module';
import type { SolverProtocol } from './protocol';
import { createSolverWorkerImpl } from './worker-impl';

// tsconfig.app.json types `self` as Window (lib DOM, not WebWorker), whose postMessage wants a
// targetOrigin. The options form exists on both Window and DedicatedWorkerGlobalScope, so this
// small adapter fits MessageEndpoint without a cast or another lib (as in the OCCT worker).
const endpoint: MessageEndpoint = {
  postMessage: (msg, transfer) => {
    self.postMessage(msg, { transfer });
  },
  addEventListener: (type, fn) => {
    self.addEventListener(type, fn);
  },
};

// Synchronously at start: a message arriving before the listener is registered would be lost.
// The module is loaded lazily, on the first call (spec 12 "Řešič vazeb", Worker).
serveRpc<SolverProtocol>(
  endpoint,
  createSolverWorkerImpl(() => loadPlanegcs({ locateWasm: () => wasmUrl })),
);
