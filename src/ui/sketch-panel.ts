import type { SketchConstraintRow, SketchState } from '@/interaction';

// Texts of the SketchPanel (spec 11, "Komponenty"): what the status line says and how a
// constraint row is named. Pure functions of the state, so the component holds only bindings.

export interface StatusText {
  /** Translation key. */
  readonly key: string;
  readonly params: Readonly<Record<string, number>>;
}

/** The status of the last solve: solving, fully defined, degrees of freedom, or its failure. */
export function sketchStatusText(state: SketchState): StatusText {
  switch (state.status) {
    case 'solving':
      return { key: 'sketch.status.solving', params: {} };
    case 'conflict':
      return { key: 'sketch.conflict', params: {} };
    case 'failed':
      return { key: 'sketch.solverFailed', params: {} };
    case 'ok':
      return state.fullyDefined
        ? { key: 'sketch.status.defined', params: {} }
        : { key: 'sketch.status.dof', params: { n: state.dof ?? 0 } };
  }
}

/** The name of a constraint row: `t('sketch.constraint.<kind>') + ' ' + n` ("Vzdálenost 1"). */
export function constraintRowLabel(
  t: (key: string) => string,
  row: Pick<SketchConstraintRow, 'kind' | 'n'>,
): string {
  return `${t(`sketch.constraint.${row.kind}`)} ${String(row.n)}`;
}
