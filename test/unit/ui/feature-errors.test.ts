import { describe, expect, it } from 'vitest';
import type { FeatureId, ParamIssue } from '@/document';
import type { TreeRow, TreeStatus } from '@/interaction';
import { dialogErrors, featureErrorOf } from '@/ui/feature-errors';

const fid = (id: string): FeatureId => id as FeatureId; // test ids are trusted

const F1 = fid('f1');
const F2 = fid('f2');

function aRow(
  id: FeatureId,
  status: TreeStatus,
  extra: {
    readonly message?: string | null;
    readonly issues?: readonly ParamIssue[] | null;
    readonly detail?: string | null;
  } = {},
): TreeRow {
  return {
    id,
    name: String(id),
    type: 'fillet',
    typeLabel: 'fillet.label',
    icon: null,
    issues: extra.issues ?? null,
    status,
    message: extra.message ?? null,
    detail: extra.detail ?? null,
    selected: false,
    editing: true,
    dependents: 0,
  };
}

const TOO_FEW_EDGES: ParamIssue = { param: 'edges', code: 'param.tooFewRefs', params: { min: 1 } };
const FILLET_FAILED: ParamIssue = { param: 'radius', code: 'fillet.failed' };
const WHOLE_FORM: ParamIssue = { param: '', code: 'box.tooSmall' };

describe('featureErrorOf', () => {
  it('is null without a row of the feature', () => {
    expect(featureErrorOf([aRow(F2, 'error', { message: 'x' })], F1)).toBeNull();
  });

  it('is null for a row that is not an error', () => {
    for (const status of ['ok', 'warning', 'suppressed', 'rolledBack', 'pending'] as const) {
      expect(featureErrorOf([aRow(F1, status, { message: 'm' })], F1), status).toBeNull();
    }
  });

  it('an error with issues: the issues (the presenter already dropped the message)', () => {
    const rows = [aRow(F2, 'ok'), aRow(F1, 'error', { issues: [FILLET_FAILED] })];
    expect(featureErrorOf(rows, F1)).toEqual({
      message: null,
      issues: [FILLET_FAILED],
      detail: null,
    });
  });

  it('shows the row as the presenter made it: no rule of its own about the message', () => {
    // FeatureTreeModel never makes this row (issues drop the message); the view does not decide.
    const rows = [aRow(F1, 'error', { message: 'radius: fillet.failed', issues: [FILLET_FAILED] })];
    expect(featureErrorOf(rows, F1)).toEqual({
      message: 'radius: fillet.failed',
      issues: [FILLET_FAILED],
      detail: null,
    });
  });

  it('an error without issues (from the kernel): the message', () => {
    const rows = [aRow(F1, 'error', { message: 'BRep_API: command not done' })];
    expect(featureErrorOf(rows, F1)).toEqual({
      message: 'BRep_API: command not done',
      issues: [],
      detail: null,
    });
    const empty = [aRow(F1, 'error', { message: 'Standard_Failure', issues: [] })];
    expect(featureErrorOf(empty, F1)).toEqual({
      message: 'Standard_Failure',
      issues: [],
      detail: null,
    });
  });

  it('carries the detail of a row with translated issues (D9 of M19.2)', () => {
    const kernel: ParamIssue = { param: '', code: 'kernel.operationFailed' };
    const rows = [aRow(F1, 'error', { issues: [kernel], detail: 'BRep_API: command not done' })];
    expect(featureErrorOf(rows, F1)).toEqual({
      message: null,
      issues: [kernel],
      detail: 'BRep_API: command not done',
    });
  });

  it('is null for a draft row (D6 of M19.2)', () => {
    expect(featureErrorOf([aRow(F1, 'draft')], F1)).toBeNull();
  });

  it('is null for an error with neither a message nor issues', () => {
    expect(featureErrorOf([aRow(F1, 'error')], F1)).toBeNull();
  });
});

describe('dialogErrors', () => {
  it('is null without issues of the whole form and without an error of the feature', () => {
    expect(dialogErrors([], null)).toBeNull();
  });

  it('shows the issues of the whole form (param ""), not those of a field', () => {
    expect(dialogErrors([TOO_FEW_EDGES, WHOLE_FORM], null)).toEqual({
      message: null,
      issues: [WHOLE_FORM],
      detail: null,
    });
  });

  it('a new feature without input: the issues at the fields suffice, no block', () => {
    const error = featureErrorOf([aRow(F1, 'error', { issues: [TOO_FEW_EDGES] })], F1);
    expect(dialogErrors([TOO_FEW_EDGES], error)).toBeNull();
  });

  it('an issue the fields do not show (the fillet the kernel could not make) is in the block', () => {
    const error = featureErrorOf([aRow(F1, 'error', { issues: [FILLET_FAILED] })], F1);
    expect(dialogErrors([], error)).toEqual({
      message: null,
      issues: [FILLET_FAILED],
      detail: null,
    });
  });

  it('an issue repeats in the block only once, by its param and code', () => {
    const stale: ParamIssue = { ...TOO_FEW_EDGES, params: { min: 2 } };
    const error = featureErrorOf(
      [aRow(F1, 'error', { issues: [stale, WHOLE_FORM, FILLET_FAILED] })],
      F1,
    );
    expect(dialogErrors([TOO_FEW_EDGES, WHOLE_FORM], error)).toEqual({
      message: null,
      issues: [WHOLE_FORM, FILLET_FAILED],
      detail: null,
    });
  });

  it('the message of the feature comes with the issues of the form', () => {
    const error = featureErrorOf([aRow(F1, 'error', { message: 'kernel says no' })], F1);
    expect(dialogErrors([WHOLE_FORM], error)).toEqual({
      message: 'kernel says no',
      issues: [WHOLE_FORM],
      detail: null,
    });
  });

  it('carries the detail of the feature error (D9 of M19.2)', () => {
    const kernel: ParamIssue = { param: '', code: 'kernel.operationFailed' };
    const error = featureErrorOf([aRow(F1, 'error', { issues: [kernel], detail: 'BRep' })], F1);
    expect(dialogErrors([], error)).toEqual({ message: null, issues: [kernel], detail: 'BRep' });
  });

  it('a detail alone makes no block: the fields already show every issue', () => {
    const error = featureErrorOf(
      [aRow(F1, 'error', { issues: [TOO_FEW_EDGES], detail: 'edges: param.tooFewRefs' })],
      F1,
    );
    expect(dialogErrors([TOO_FEW_EDGES], error)).toBeNull();
  });

  it('is frozen', () => {
    const errors = dialogErrors([WHOLE_FORM], null);
    expect(Object.isFrozen(errors)).toBe(true);
    expect(Object.isFrozen(errors?.issues)).toBe(true);
  });
});
