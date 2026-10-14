import type { FeatureId, ParamIssue } from '@/document';
import type { TreeRow } from '@/interaction';

// The block of errors under the fields of the feature dialog (spec 11, "Komponenty"; M19.1 Ú13,
// revize U2): what the fields cannot show – issues of the whole form (param '') and the error of
// the edited feature from its row in the tree (the regeneration: a fillet the kernel could not
// make, a reference that no longer resolves, a kernel message). Issues a field already shows are
// not repeated, so a new feature without its input shows none. M19.2 (D9): the technical message
// behind translated issues goes along as `detail`, for the collapsible details of the block.

/** An error to show: translated issues and a technical message (under a translated heading). */
export interface FeatureErrorView {
  /** TreeRow.message: the presenter leaves it only to a row without translated issues. */
  readonly message: string | null;
  readonly issues: readonly ParamIssue[];
  /** TreeRow.detail: the technical message behind the issues, for the details; null = none. */
  readonly detail: string | null;
}

/** The error of the feature from its row in the tree; null when the row is not an error. */
export function featureErrorOf(
  rows: readonly TreeRow[],
  featureId: FeatureId,
): FeatureErrorView | null {
  const row = rows.find((r) => r.id === featureId);
  if (row?.status !== 'error') return null;
  // Which of the message and the issues to show is the rule of FeatureTreeModel (ADR 0010).
  const { message, detail } = row;
  const issues = row.issues ?? [];
  if (message === null && issues.length === 0) return null;
  return Object.freeze({ message, issues: Object.freeze([...issues]), detail });
}

/**
 * The block of the dialog: the issues of the whole form (`formIssues` with param '') and the
 * error of the feature without the issues the form already has (same param and code; the row
 * may be one regeneration older than the form). null = no block; the detail alone makes none, it
 * only explains what the block shows.
 */
export function dialogErrors(
  formIssues: readonly ParamIssue[],
  featureError: FeatureErrorView | null,
): FeatureErrorView | null {
  const ofForm = formIssues.filter((issue) => issue.param === '');
  const ofFeature = (featureError?.issues ?? []).filter(
    (issue) =>
      !formIssues.some((shown) => shown.param === issue.param && shown.code === issue.code),
  );
  const issues = [...ofForm, ...ofFeature];
  const message = featureError?.message ?? null;
  if (message === null && issues.length === 0) return null;
  const detail = featureError?.detail ?? null;
  return Object.freeze({ message, issues: Object.freeze(issues), detail });
}
