import type { SketchConstraintRow, SketchEditor } from '@/sketcher';

// Texts and small behaviour of the SketchPanel (spec 11, "Komponenty"): how a constraint row is
// named, the switch "Show constraints" and the focus of a new dimension (M25). The status line is
// SketchState.statusKey and the field "Plane" SketchState.planeField (M21) of the sketcher; ui
// only translates them.

/** The name of a constraint row: `t('sketch.constraint.<kind>') + ' ' + n` ("Vzdálenost 1"). */
export function constraintRowLabel(
  t: (key: string) => string,
  row: Pick<SketchConstraintRow, 'kind' | 'n'>,
): string {
  return `${t(`sketch.constraint.${row.kind}`)} ${String(row.n)}`;
}

/** The switch "Show constraints" of the panel (spec 12, "Glyfy vazeb (M25)"): the other state. */
export function toggleShowAllConstraints(
  sketches: Pick<SketchEditor, 'showAllConstraints' | 'setShowAllConstraints'>,
): void {
  sketches.setShowAllConstraints(!sketches.showAllConstraints.get());
}

/** The collapsible section of the constraint list (an HTMLDetailsElement in the panel). */
export interface CollapsibleSection {
  open: boolean;
}

/** The value field of a dimension (an HTMLInputElement in the panel). */
export interface FocusableField {
  focus(): void;
  select(): void;
}

/**
 * A dimension just made by the tool gets the focus of its field (spec 11, "Režim skici"). After
 * the tick (the row and the refs exist), the collapsed list opens first (M25: a field in a closed
 * <details> cannot take the focus), then the field is focused and its text selected. Without the
 * section or the field nothing happens.
 */
export async function focusNewDimension(
  tick: () => Promise<unknown>,
  section: () => CollapsibleSection | null,
  field: () => FocusableField | null,
): Promise<void> {
  await tick();
  const list = section();
  // The section is the live element of the panel; opening it is the point (it is not domain data).
  if (list !== null) list.open = true;
  const input = field();
  input?.focus();
  input?.select();
}
