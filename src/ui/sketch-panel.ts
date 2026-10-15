import type { SketchConstraintRow } from '@/sketcher';

// Texts of the SketchPanel (spec 11, "Komponenty"): how a constraint row is named. The status
// line is SketchState.statusKey of interaction; ui only translates it.

/** The name of a constraint row: `t('sketch.constraint.<kind>') + ' ' + n` ("Vzdálenost 1"). */
export function constraintRowLabel(
  t: (key: string) => string,
  row: Pick<SketchConstraintRow, 'kind' | 'n'>,
): string {
  return `${t(`sketch.constraint.${row.kind}`)} ${String(row.n)}`;
}
