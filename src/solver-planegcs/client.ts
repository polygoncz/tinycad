import { RpcError, type Disposable, type RpcClient } from '@/core';
import type { ConstraintSolver } from '@/sketch';
import type { SolverProtocol } from './protocol';

/** One live connection to a solver worker. */
export interface SolverConnection {
  readonly rpc: Pick<RpcClient<SolverProtocol>, 'call'>;
  /** Ends the connection: fails its pending calls and terminates the worker. */
  terminate(): void;
}

/**
 * ConstraintSolver on the main thread that forwards every solve to a worker (spec 12 "Řešič
 * vazeb", Worker; ADR 0016). The connection is made by `connect` on the first solve. A call
 * rejected with RpcError 'disconnected' (the worker died) ends the connection and the next solve
 * makes a new one. dispose ends the connection; every later solve rejects with 'disconnected'.
 * The input is cloned by postMessage synchronously in solve (the port reads it at call time).
 */
export function createSolverClient(connect: () => SolverConnection): ConstraintSolver & Disposable {
  let current: SolverConnection | undefined;
  let disposed = false;

  return {
    solve(input) {
      if (disposed) {
        return Promise.reject(new RpcError('disconnected', 'Constraint solver disposed'));
      }
      const conn = (current ??= connect());
      return conn.rpc.call('solve', input).catch((e: unknown) => {
        if (e instanceof RpcError && e.code === 'disconnected' && current === conn) {
          current = undefined;
          conn.terminate();
        }
        throw e;
      });
    },
    dispose() {
      disposed = true;
      const conn = current;
      current = undefined;
      conn?.terminate();
    },
  };
}
