import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import type { BodyId, FeatureId } from '@/document';
import { aFeature } from '@/document/testing';
import { OP_VERSION } from '@/ops';
import type {
  BatchOp,
  BodyRenameOp,
  BodySetColorOp,
  BodySetMaterialOp,
  BodySetVisibleOp,
  DocumentRenameOp,
  FeatureAddOp,
  FeatureMoveOp,
  FeatureRemoveOp,
  FeatureRenameOp,
  FeatureSetParamsOp,
  FeatureSuppressOp,
  StudioSetRollbackOp,
} from '@/ops';
import { BodyMaterial, OperationSchema } from '@/protocol';
import { operationFromProto, operationToProto } from '@/remote/testing';

const F = 'f1' as FeatureId; // an id as the tests of ops write it
const B = 'f1/body' as BodyId; // an id as the tests of ops write it

const REMOVE: FeatureRemoveOp = { type: 'feature.remove', v: 1, featureId: F };
const ROLLBACK: StudioSetRollbackOp = { type: 'studio.setRollback', v: 1, index: 0 };
const INNER_BATCH: BatchOp = { type: 'batch', v: 1, ops: [ROLLBACK] };

/** Every operation type of spec 04 with its payload. */
type AnyOperation =
  | FeatureAddOp
  | FeatureRemoveOp
  | FeatureSetParamsOp
  | FeatureRenameOp
  | FeatureSuppressOp
  | FeatureMoveOp
  | StudioSetRollbackOp
  | BodyRenameOp
  | BodySetVisibleOp
  | BodySetColorOp
  | BodySetMaterialOp
  | DocumentRenameOp
  | BatchOp;

// One operation of every type of spec 04 (13 with batch), with the current v.
const OPERATIONS: readonly AnyOperation[] = [
  {
    type: 'feature.add',
    v: OP_VERSION['feature.add'],
    feature: aFeature({ id: F, type: 'box', params: { width: 2, origin: [0, 0, 0] } }),
    index: 3,
  },
  { type: 'feature.remove', v: OP_VERSION['feature.remove'], featureId: F },
  {
    type: 'feature.setParams',
    v: OP_VERSION['feature.setParams'],
    featureId: F,
    typeVersion: 1,
    params: { width: 2, nested: { list: [1, 'a', true, null] } },
  },
  { type: 'feature.rename', v: OP_VERSION['feature.rename'], featureId: F, name: 'Box 2' },
  { type: 'feature.suppress', v: OP_VERSION['feature.suppress'], featureId: F, suppressed: true },
  { type: 'feature.move', v: OP_VERSION['feature.move'], featureId: F, toIndex: 0 },
  { type: 'studio.setRollback', v: OP_VERSION['studio.setRollback'], index: 2 },
  { type: 'body.rename', v: OP_VERSION['body.rename'], body: B, name: 'Bracket' },
  { type: 'body.setVisible', v: OP_VERSION['body.setVisible'], body: B, visible: false },
  { type: 'body.setColor', v: OP_VERSION['body.setColor'], body: B, color: '#ff8800' },
  { type: 'body.setColor', v: OP_VERSION['body.setColor'], body: B, color: null },
  { type: 'body.setMaterial', v: OP_VERSION['body.setMaterial'], body: B, material: 'brass' },
  { type: 'document.rename', v: OP_VERSION['document.rename'], name: 'Bracket' },
  { type: 'batch', v: OP_VERSION.batch, ops: [REMOVE, INNER_BATCH] },
];

describe('operations', () => {
  it('covers every type of operation', () => {
    expect(new Set(OPERATIONS.map((op) => op.type))).toEqual(new Set(Object.keys(OP_VERSION)));
  });

  it.each(OPERATIONS.map((op) => [op.type, op] as const))('%s goes there and back', (_, op) => {
    expect(operationFromProto(operationToProto(op))).toEqual(op);
  });

  it('puts the fields 1:1 into the message', () => {
    const op: FeatureMoveOp = { type: 'feature.move', v: 1, featureId: F, toIndex: 4 };
    const msg = operationToProto(op);
    expect(msg.op).toEqual(expect.objectContaining({ case: 'featureMove' }));
    expect(msg.op.value).toEqual(expect.objectContaining({ featureId: 'f1', toIndex: 4 }));
  });

  it('sends a null colour as an unset field', () => {
    const op: BodySetColorOp = { type: 'body.setColor', v: 1, body: B, color: null };
    const msg = operationToProto(op);
    expect(msg.op.case).toBe('bodySetColor');
    expect(msg.op.case === 'bodySetColor' && msg.op.value.color).toBeUndefined();
  });

  it('sends the material as the enum', () => {
    const op: BodySetMaterialOp = {
      type: 'body.setMaterial',
      v: 1,
      body: B,
      material: 'aluminium',
    };
    const msg = operationToProto(op);
    expect(msg.op.case === 'bodySetMaterial' && msg.op.value.material).toBe(BodyMaterial.ALUMINIUM);
  });

  it('keeps an integer of the params an integer', () => {
    const op: FeatureSetParamsOp = {
      type: 'feature.setParams',
      v: 2,
      featureId: F,
      typeVersion: 1,
      params: { count: 2 },
    };
    expect(JSON.stringify(operationFromProto(operationToProto(op)))).toContain('"count":2}');
  });

  it('reads missing params as an empty object', () => {
    const op = operationFromProto(
      create(OperationSchema, {
        op: { case: 'featureSetParams', value: { featureId: 'f1', typeVersion: 1 } },
      }),
    );
    expect(op).toEqual({
      type: 'feature.setParams',
      v: 2,
      featureId: F,
      typeVersion: 1,
      params: {},
    });
  });

  it('refuses a message without an operation', () => {
    expect(() => operationFromProto(create(OperationSchema, {}))).toThrow(/no operation/);
  });

  it('refuses an unspecified material', () => {
    const msg = create(OperationSchema, {
      op: { case: 'bodySetMaterial', value: { bodyId: 'f1/body' } },
    });
    expect(() => operationFromProto(msg)).toThrow(/material/);
  });

  it('refuses an operation of an unknown type', () => {
    expect(() => operationToProto({ type: 'feature.explode', v: 1 })).toThrow(/feature\.explode/);
  });
});
