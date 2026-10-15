import { describe, expect, it } from 'vitest';
import { RpcError } from '@/core';
import type { DocumentRenameOp, LogEntry } from '@/ops';
import {
  createStoreError,
  renamedTo,
  snapshotSeqsToKeep,
  storeErrorCode,
} from '@/persistence/store';

describe('storeErrorCode', () => {
  it.each(['not-found', 'already-exists', 'seq-gap', 'snapshot-ahead', 'invalid'] as const)(
    'reads %s from an Error with code',
    (code) => {
      expect(storeErrorCode(Object.assign(new Error('x'), { code }))).toBe(code);
    },
  );

  it('reads the code of an RpcError that crossed core/rpc', () => {
    expect(storeErrorCode(new RpcError('seq-gap', 'gap'))).toBe('seq-gap');
  });

  it('reads the code of any object with a store code', () => {
    expect(storeErrorCode({ code: 'not-found' })).toBe('not-found');
  });

  it.each([
    ['an unknown code', new RpcError('internal', 'boom')],
    ['an Error without code', new Error('io')],
    ['a non-string code', { code: 1 }],
    ['a string', 'not-found'],
    ['undefined', undefined],
    ['null', null],
  ])('returns undefined for %s', (_, e) => {
    expect(storeErrorCode(e)).toBeUndefined();
  });
});

describe('createStoreError', () => {
  it('creates an Error whose code storeErrorCode reads', () => {
    const e = createStoreError('seq-gap', 'gap');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('gap');
    expect(storeErrorCode(e)).toBe('seq-gap');
  });
});

// Pruning is not observable through the port (load returns only the latest and the base),
// so the rule is checked here on its own (Q009).
describe('snapshotSeqsToKeep', () => {
  it('keeps the base snapshot and the 3 with the highest atSeq', () => {
    expect(snapshotSeqsToKeep([0, 100, 200, 300, 400]).toSorted((a, b) => a - b)).toEqual([
      0, 200, 300, 400,
    ]);
  });

  it('decides by atSeq, not by order of writing', () => {
    expect(snapshotSeqsToKeep([0, 400, 100, 300, 200]).toSorted((a, b) => a - b)).toEqual([
      0, 200, 300, 400,
    ]);
  });

  it('keeps everything while there are at most 3 besides the base', () => {
    expect(snapshotSeqsToKeep([0, 5, 9, 7]).toSorted((a, b) => a - b)).toEqual([0, 5, 7, 9]);
  });
});

describe('renamedTo', () => {
  function entry(seq: number, op: LogEntry['op']): LogEntry {
    return { seq, kind: 'do', op, inverse: op, label: op.type, time: 0 };
  }
  const rename = (name: string): DocumentRenameOp => ({ type: 'document.rename', v: 1, name });
  const other: LogEntry['op'] = { type: 'studio.setRollback', v: 1 };

  it('is the name of the last document.rename of the batch', () => {
    expect(renamedTo([entry(1, rename('A')), entry(2, other), entry(3, rename('B'))])).toBe('B');
  });

  it('is undefined for a batch without document.rename', () => {
    expect(renamedTo([entry(1, other)])).toBeUndefined();
    expect(renamedTo([])).toBeUndefined();
  });
});
