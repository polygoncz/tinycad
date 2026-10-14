import type { OpHandler } from '../op-handler';
import { OP_VERSION } from '../operation';
import type { BodyRenameOp, BodySetColorOp, BodySetVisibleOp } from '../operation';
import { bodyColorOrNull, bodyIdText, boolean, string, validateShape } from './shape';

// Body metadata (M11, spec 03). The document does not know bodies, so a body without metadata,
// even one no feature produces, is no error. The rollback bar never moves here.

const rename: OpHandler<BodyRenameOp> = {
  type: 'body.rename',
  version: OP_VERSION['body.rename'],
  invert: (doc, op) => ({
    type: 'body.rename',
    v: OP_VERSION['body.rename'],
    body: op.body,
    name: doc.bodyMeta(op.body).name ?? '',
  }),
  apply: (doc, op) => {
    // '' drops the name: setBodyMeta keeps the canonical form.
    doc.setBodyMeta(op.body, { ...doc.bodyMeta(op.body), name: op.name });
  },
  validate: validateShape({ body: bodyIdText, name: string }),
};

const setVisible: OpHandler<BodySetVisibleOp> = {
  type: 'body.setVisible',
  version: OP_VERSION['body.setVisible'],
  invert: (doc, op) => ({
    type: 'body.setVisible',
    v: OP_VERSION['body.setVisible'],
    body: op.body,
    visible: doc.bodyMeta(op.body).hidden !== true,
  }),
  apply: (doc, op) => {
    const { name, color } = doc.bodyMeta(op.body);
    doc.setBodyMeta(op.body, {
      ...(name === undefined ? {} : { name }),
      ...(op.visible ? {} : { hidden: true }),
      ...(color === undefined ? {} : { color }),
    });
  },
  validate: validateShape({ body: bodyIdText, visible: boolean }),
};

// The same color is a valid operation: setBodyMeta then changes nothing and emits nothing.
const setColor: OpHandler<BodySetColorOp> = {
  type: 'body.setColor',
  version: OP_VERSION['body.setColor'],
  invert: (doc, op) => ({
    type: 'body.setColor',
    v: OP_VERSION['body.setColor'],
    body: op.body,
    color: doc.bodyMeta(op.body).color ?? null,
  }),
  apply: (doc, op) => {
    const { name, hidden } = doc.bodyMeta(op.body);
    doc.setBodyMeta(op.body, {
      ...(name === undefined ? {} : { name }),
      ...(hidden === undefined ? {} : { hidden }),
      ...(op.color === null ? {} : { color: op.color }),
    });
  },
  validate: validateShape({ body: bodyIdText, color: bodyColorOrNull }),
};

export const bodyHandlers: readonly OpHandler[] = [rename, setVisible, setColor];
