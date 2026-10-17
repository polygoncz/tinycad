import { describe, expect, it } from 'vitest';
import type { DocumentRenameOp } from '@/ops';
import { aFakeOps } from '@/ops/testing';
import { refuseChanges, refuseUndo } from '@/app/read-only';

describe('refuseChanges', () => {
  it('dispatch and begin throw at once, the document is open read-only; nothing is sent', () => {
    const ops = aFakeOps();
    const guarded = refuseChanges(ops);
    const op: DocumentRenameOp = { type: 'document.rename', v: 1, name: 'x' };
    expect(() => guarded.dispatch(op)).toThrow(/read-only/);
    expect(() => guarded.begin('edit')).toThrow(/read-only/);
    expect(ops.sent).toEqual([]);
  });

  it('keeps the transaction state of the inner dispatcher', () => {
    const ops = aFakeOps();
    const guarded = refuseChanges(ops);
    expect(guarded.inTransaction).toBe(false);
    ops.begin('x');
    expect(guarded.inTransaction).toBe(true);
  });
});

describe('refuseUndo', () => {
  it('cannot undo or redo and both refuse at once; the events stay', () => {
    const { undo, sent } = aFakeOps({ canUndo: true, canRedo: true });
    const guarded = refuseUndo(undo);
    expect(guarded.canUndo()).toBe(false);
    expect(guarded.canRedo()).toBe(false);
    expect(() => guarded.undo()).toThrow(/read-only/);
    expect(() => guarded.redo()).toThrow(/read-only/);
    expect(guarded.events).toBe(undo.events);
    expect(sent).toEqual([]);
  });
});
