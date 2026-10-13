import type { OpHandler } from '../op-handler';
import { OP_VERSION } from '../operation';
import type { StudioSetRollbackOp } from '../operation';
import { validateShape, wholeNumber } from './shape';

const setRollback: OpHandler<StudioSetRollbackOp> = {
  type: 'studio.setRollback',
  version: OP_VERSION['studio.setRollback'],
  invert: (doc) => ({
    type: 'studio.setRollback',
    v: OP_VERSION['studio.setRollback'],
    index: doc.studio.rollbackIndex,
  }),
  apply: (doc, op) => {
    doc.setRollbackIndex(op.index);
  },
  validate: validateShape({ index: wholeNumber(0) }),
};

export const studioHandlers: readonly OpHandler[] = [setRollback];
