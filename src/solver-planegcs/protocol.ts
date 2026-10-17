import type { ConstraintSolver } from '@/sketch';

/** What the worker serves: the solver, plus waiting for the planegcs module. */
interface SolverWorkerApi extends ConstraintSolver {
  /** Resolves once the planegcs module is loaded (loads it if needed); rejects if loading fails. */
  ready(): Promise<void>;
}

/**
 * RPC protocol of the solver worker (spec 12 "Řešič vazeb", Worker): one entry per
 * ConstraintSolver method with the same arguments and result – derived from the port, so the two
 * cannot drift apart – plus `ready(): void`.
 */
export type SolverProtocol = {
  readonly [K in keyof SolverWorkerApi]: {
    readonly args: Parameters<SolverWorkerApi[K]>;
    readonly result: Awaited<ReturnType<SolverWorkerApi[K]>>;
  };
};
