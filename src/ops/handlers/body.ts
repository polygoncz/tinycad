import { DEFAULT_BODY_MATERIAL } from '@/document';
import type { BodyMeta } from '@/document';
import type { OpHandler } from '../op-handler';
import { OP_VERSION } from '../operation';
import type {
  BodyRenameOp,
  BodySetColorOp,
  BodySetMaterialOp,
  BodySetVisibleOp,
} from '../operation';
import { bodyColorOrNull, bodyIdText, bodyMaterial, boolean, string, validateShape } from './shape';

// Body metadata (M11, spec 03). The document does not know bodies, so a body without metadata,
// even one no feature produces, is no error. The rollback bar never moves here.
// Every apply spreads the current metadata and overrides only its own field, so a field added
// later (material in M24) survives; setBodyMeta keeps the canonical form.

/**
 * The metadata without one field, every other field kept. Dropping the key rather than setting
 * it to undefined, which exactOptionalPropertyTypes refuses.
 */
function omit<K extends keyof BodyMeta>(meta: BodyMeta, key: K): Omit<BodyMeta, K> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the binding only drops the key from rest
  const { [key]: _dropped, ...rest } = meta;
  return rest;
}

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
    const rest = omit(doc.bodyMeta(op.body), 'hidden');
    doc.setBodyMeta(op.body, op.visible ? rest : { ...rest, hidden: true });
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
    const rest = omit(doc.bodyMeta(op.body), 'color');
    doc.setBodyMeta(op.body, op.color === null ? rest : { ...rest, color: op.color });
  },
  validate: validateShape({ body: bodyIdText, color: bodyColorOrNull }),
};

// The same material is a valid operation too; 'plastic' is dropped by the canonical form.
const setMaterial: OpHandler<BodySetMaterialOp> = {
  type: 'body.setMaterial',
  version: OP_VERSION['body.setMaterial'],
  invert: (doc, op) => ({
    type: 'body.setMaterial',
    v: OP_VERSION['body.setMaterial'],
    body: op.body,
    material: doc.bodyMeta(op.body).material ?? DEFAULT_BODY_MATERIAL,
  }),
  apply: (doc, op) => {
    doc.setBodyMeta(op.body, { ...doc.bodyMeta(op.body), material: op.material });
  },
  validate: validateShape({ body: bodyIdText, material: bodyMaterial }),
};

export const bodyHandlers: readonly OpHandler[] = [rename, setVisible, setColor, setMaterial];
