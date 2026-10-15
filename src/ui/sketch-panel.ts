import type { SketchConstraintRow } from '@/sketcher';

// Texts of the SketchPanel (spec 11, "Komponenty"): how a constraint row is named. The status line
// is SketchState.statusKey and the field "Plane" SketchState.planeField (M21) of the sketcher; ui
// only translates them.

/** The name of a constraint row: `t('sketch.constraint.<kind>') + ' ' + n` ("Vzdálenost 1"). */
export function constraintRowLabel(
  t: (key: string) => string,
  row: Pick<SketchConstraintRow, 'kind' | 'n'>,
): string {
  return `${t(`sketch.constraint.${row.kind}`)} ${String(row.n)}`;
}
