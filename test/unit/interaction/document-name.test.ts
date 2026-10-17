import { describe, expect, it } from 'vitest';
import { ObservableValue } from '@/core';
import { OP_VERSION } from '@/ops';
import type { DocumentRenameOp } from '@/ops';
import { aFakeOps } from '@/ops/testing';
import { createDocumentNameModel } from '@/interaction/document-name';

function setup(opts: { locked?: boolean } = {}) {
  const ops = aFakeOps({ meta: { name: 'Untitled' } });
  const locked = new ObservableValue(opts.locked ?? false);
  const model = createDocumentNameModel({
    doc: ops.doc,
    ops,
    locked: locked.asObservable(),
  });
  return { ops, doc: ops.doc, locked, model };
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
    const { model, doc } = setup();
    let calls = 0;
    model.name.subscribe(() => calls++);
    doc.replace({ name: 'Part' });
    expect(model.name.get()).toBe('Part');
    expect(calls).toBe(1);
  });

  it('a change of the studio alone does not notify', () => {
    const { model, doc } = setup();
    let calls = 0;
    model.name.subscribe(() => calls++);
    doc.replace({ studio: { features: [], rollbackIndex: 0, bodies: {} } });
    expect(calls).toBe(0);
  });

  it("rename('  Díl  ') sends the trimmed name as one document.rename; the name follows the answer", () => {
    const { model, ops } = setup();
    expect(model.rename('  Díl  ')).toBe(true);
    expect(ops.sent).toEqual([{ kind: 'dispatch', op: renameTo('Díl') }]);
    // No optimism (N168): the name changes with the read model of the answer.
    expect(model.name.get()).toBe('Untitled');
    ops.answer({ document: { name: 'Díl' } });
    expect(model.name.get()).toBe('Díl');
  });

  it.each([[''], ['   ']])('rename(%j) returns false and sends nothing', (name) => {
    const { model, ops } = setup();
    expect(model.rename(name)).toBe(false);
    expect(ops.sent).toEqual([]);
  });

  it('the same name (after trimming) returns true without an operation', () => {
    const { model, ops } = setup();
    expect(model.rename(' Untitled ')).toBe(true);
    expect(ops.sent).toEqual([]);
  });

  it('while locked rename returns false and sends nothing; canRename is false', () => {
    const { model, ops } = setup({ locked: true });
    expect(model.canRename.get()).toBe(false);
    expect(model.rename('Díl')).toBe(false);
    expect(ops.sent).toEqual([]);
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
    const { model, doc } = setup();
    model.dispose();
    doc.replace({ name: 'Part' });
    expect(model.name.get()).toBe('Untitled');
  });
});
