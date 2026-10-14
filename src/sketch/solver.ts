import type { Vec2 } from '@/core';
import type { SketchConstraintId, SketchData, SketchEntity, SketchEntityId } from './model';

// The constraint solver port (spec 12 "Řešič vazeb", ADR 0016). The adapter lives in
// solver-planegcs; tests use the FakeSolver from testing.ts.

export interface SolveInput extends SketchData {
  /** The dragged point and its target in the sketch plane; temporary constraints that yield to the others. */
  readonly drag?: { readonly point: SketchEntityId; readonly to: Vec2 };
}

export type SolveStatus = 'ok' | 'conflict' | 'failed';

export interface SolveResult {
  readonly status: SolveStatus;
  /** Only 'ok': the input entities in the same order, ids and fields, with new point coordinates and circle radii. */
  readonly entities: readonly SketchEntity[] | null;
  /** Degrees of freedom without the drag; null for 'failed'. */
  readonly dof: number | null;
  readonly conflicting: readonly SketchConstraintId[];
  readonly redundant: readonly SketchConstraintId[];
}

export interface ConstraintSolver {
  /** Rejects only when the infrastructure fails (worker gone → RpcError 'disconnected'); a failed solve is a status. */
  solve(input: SolveInput): Promise<SolveResult>;
}
