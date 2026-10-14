import type { RpcImpl } from '@/core';
import type { SolveInput, SolveResult } from '@/sketch';
import type { PlanegcsModule } from './planegcs-module';
import type { SolverProtocol } from './protocol';
import { FAILED, solveSketch } from './solve';
import { isWasmTrap } from './wasm-trap';

// Worker side of the solver (spec 12 "Řešič vazeb", Worker; ADR 0016). serveRpc gets this
// implementation synchronously at worker start; the module is loaded lazily on the first call.
// Internal to solver-planegcs.

/** The solver over a lazily loaded module, with plain (not transferred) results. */
export interface SolverService {
  ready(): Promise<void>;
  solve(input: SolveInput): Promise<SolveResult>;
}

/** Serves the solver in the worker; `load` loads a new instance of the planegcs module. */
export function createSolverWorkerImpl(
  load: () => Promise<PlanegcsModule>,
): RpcImpl<SolverProtocol> {
  return createSolverService(load);
}

/**
 * The logic of the worker, shared with the in-thread solver for tests (testing.ts):
 * - the module is loaded on the first call and kept; a failed load rejects the call with an
 *   Error with the reason and is not kept, so the next call tries again;
 * - a WebAssembly.RuntimeError (out of memory, abort) discards the module – the next call loads
 *   a new one – and the call returns status 'failed'.
 */
export function createSolverService(load: () => Promise<PlanegcsModule>): SolverService {
  let module: Promise<PlanegcsModule> | undefined;

  function current(): Promise<PlanegcsModule> {
    if (module !== undefined) return module;
    const loading = load().catch((e: unknown) => {
      if (module === loading) module = undefined;
      const reason = e instanceof Error ? e.message : String(e);
      throw new Error(`planegcs initialisation failed: ${reason}`);
    });
    module = loading;
    return loading;
  }

  return {
    ready: async () => {
      await current();
    },
    solve: async (input) => {
      const loading = current();
      const mod = await loading;
      try {
        return solveSketch(mod, input);
      } catch (e) {
        if (!isWasmTrap(e)) throw e;
        if (module === loading) module = undefined;
        return FAILED;
      }
    },
  };
}
