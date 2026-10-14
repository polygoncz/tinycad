// Ring 3 – planegcs (WASM, worker) adapter of ConstraintSolver (ADR 0016). Imported only by app.
import { createRpcClient } from '@/core';
import type { Disposable } from '@/core';
import type { ConstraintSolver } from '@/sketch';
import { createSolverClient } from './client';
import type { SolverProtocol } from './protocol';

/**
 * ConstraintSolver backed by planegcs in a dedicated worker (spec 12 "Řešič vazeb", Worker).
 * The worker starts on the first solve. A crashed worker or an undecodable message fails the
 * pending calls with 'disconnected'; such a call terminates the worker and the next solve starts
 * a new one. dispose terminates the worker; later solves reject with 'disconnected'.
 */
export function createPlanegcsSolver(): ConstraintSolver & Disposable {
  return createSolverClient(() => {
    const worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
    const rpc = createRpcClient<SolverProtocol>(worker);
    worker.onerror = (e) => {
      rpc.failAll(`Solver worker failed: ${e.message}`);
    };
    worker.onmessageerror = () => {
      rpc.failAll('Solver worker sent a message that could not be deserialized');
    };
    return {
      rpc,
      terminate: () => {
        rpc.dispose();
        worker.terminate();
      },
    };
  });
}
