import type { OpHandler } from '../op-handler';
import { OP_VERSION } from '../operation';
import type { DocumentRenameOp } from '../operation';
import type { OperationLoadError } from '../load-error';
import { validateShape } from './shape';

// The name of the document (M19.2, D5): metadata outside undo, yet changed only by a handler,
// so the log, replay, snapshots and the file all carry the current name.

/** A name the UI accepts: trimmed and not empty, so the log never holds one it would refuse. */
function documentName(value: unknown, path: string): readonly OperationLoadError[] {
  return typeof value === 'string' && value !== '' && value.trim() === value
    ? []
    : [{ path, message: 'Must be a non-empty string without spaces at the ends' }];
}

const rename: OpHandler<DocumentRenameOp> = {
  type: 'document.rename',
  version: OP_VERSION['document.rename'],
  invert: (doc) => ({
    type: 'document.rename',
    v: OP_VERSION['document.rename'],
    name: doc.meta.name,
  }),
  apply: (doc, op) => {
    doc.rename(op.name);
  },
  validate: validateShape({ name: documentName }),
};

export const documentHandlers: readonly OpHandler[] = [rename];
