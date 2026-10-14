import { describe, expect, it } from 'vitest';
import { isDocumentRename, OP_VERSION } from './operation';
import type { DocumentRenameOp } from './operation';

describe('isDocumentRename', () => {
  it('accepts document.rename with a string name', () => {
    const op: DocumentRenameOp = {
      type: 'document.rename',
      v: OP_VERSION['document.rename'],
      name: 'Díl',
    };
    expect(isDocumentRename(op)).toBe(true);
  });

  it('rejects other operations', () => {
    const op = { type: 'body.rename', v: OP_VERSION['body.rename'], body: 'b1', name: 'Díl' };
    expect(isDocumentRename(op)).toBe(false);
  });

  it('rejects a document.rename without a string name (an unchecked stored op)', () => {
    expect(isDocumentRename({ type: 'document.rename', v: 1 })).toBe(false);
    // A variable, not a literal: a stored op may carry anything.
    const numbered = { type: 'document.rename', v: 1, name: 7 };
    expect(isDocumentRename(numbered)).toBe(false);
  });
});
