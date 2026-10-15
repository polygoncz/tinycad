// Test-only entry point of solver-planegcs (unit and integration tests in test/).
// dependency-cruiser allows importing it only from test code, so it never reaches the bundle.

import type { ConstraintSolver } from '@/sketch';
import { loadPlanegcs } from './planegcs-module';
import { createSolverService } from './worker-impl';

/**
 * The real planegcs solver in the calling thread (Node: the package finds its .wasm itself),
 * with the same logic as the worker: lazy loading, a new module after a WASM abort. The input
 * is cloned at call time, as postMessage does for the worker.
 */
export function createInThreadPlanegcsSolver(): ConstraintSolver {
  const service = createSolverService(() => loadPlanegcs());
  return {
    solve: (input) => service.solve(structuredClone(input)),
  };
}
