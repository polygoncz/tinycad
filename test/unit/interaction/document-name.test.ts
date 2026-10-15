import { describe, expect, it } from 'vitest';
import { ObservableValue } from '@/core';
import { OP_VERSION } from '@/ops';
import type { DocumentRenameOp, StudioSetRollbackOp } from '@/ops';
import { anOpsSession } from '@/ops/testing';
import { createDocumentNameModel } from '@/interaction/document-name';

function setup(opts: { locked?: boolean } = {}) {
  const session = anOpsSession({ meta: { name: 'Untitled' } });
  const locked = new ObservableValue(opts.locked ?? false);
  const model = createDocumentNameModel({
    doc: session.doc,
    ops: session.dispatcher,
    locked: locked.asObservable(),
  });
  return { ...session, locked, model };
}

const renameTo = (name: string): DocumentRenameOp => ({
  type: 'document.rename',
  v: OP_VERSION['document.rename'],
  name,
});

describe('createDocumentNameModel (M19.2, D5)', () => {
  it('name is the name of the document', () => {
    const { model } = setup();
    expect(model.name.get()).toBe('Untitled');
  });

  it('name follows a rename from anywhere (undo of other steps, replay, another model)', () => {
    const { model, dispatcher } = setup();
    let calls = 0;
    model.name.subscribe(() => calls++);
    dispatcher.dispatch(renameTo('Part'));
    expect(model.name.get()).toBe('Part');
    expect(calls).toBe(1);
  });

  it('a change of the studio alone does not notify', () => {
    const { model, dispatcher } = setup();
    let calls = 0;
    model.name.subscribe(() => calls++);
    const bar: StudioSetRollbackOp = { type: 'studio.setRollback', v: 1, index: 0 };
    dispatcher.dispatch(bar);
    expect(calls).toBe(0);
  });

  it("rename('  Díl  ') writes the trimmed name as one document.rename entry", () => {
    const { model, doc, log } = setup();
    expect(model.rename('  Díl  ')).toBe(true);
    expect(doc.meta.name).toBe('Díl');
    expect(model.name.get()).toBe('Díl');
    expect(log.entries()).toHaveLength(1);
    expect(log.entries()[0]).toMatchObject({
      kind: 'do',
      op: renameTo('Díl'),
      label: 'document.rename',
    });
  });

  it('the rename is not undoable', () => {
    const { model, undo } = setup();
    model.rename('Díl');
    expect(undo.canUndo()).toBe(false);
  });

  it.each([[''], ['   ']])('rename(%j) returns false and writes nothing', (name) => {
    const { model, doc, log } = setup();
    expect(model.rename(name)).toBe(false);
    expect(doc.meta.name).toBe('Untitled');
    expect(log.lastSeq).toBe(0);
  });

  it('the same name (after trimming) returns true without an operation', () => {
    const { model, log } = setup();
    expect(model.rename(' Untitled ')).toBe(true);
    expect(log.lastSeq).toBe(0);
  });

  it('while locked rename returns false and writes nothing; canRename is false', () => {
    const { model, doc, log } = setup({ locked: true });
    expect(model.canRename.get()).toBe(false);
    expect(model.rename('Díl')).toBe(false);
    expect(doc.meta.name).toBe('Untitled');
    expect(log.lastSeq).toBe(0);
  });

  it('canRename follows the lock', () => {
    const { model, locked } = setup();
    let calls = 0;
    model.canRename.subscribe(() => calls++);
    expect(model.canRename.get()).toBe(true);
    locked.set(true);
    expect(model.canRename.get()).toBe(false);
    locked.set(false);
    expect(model.canRename.get()).toBe(true);
    expect(calls).toBe(2);
  });

  it('dispose stops following the document', () => {
    const { model, dispatcher } = setup();
    model.dispose();
    dispatcher.dispatch(renameTo('Part'));
    expect(model.name.get()).toBe('Untitled');
  });
});
