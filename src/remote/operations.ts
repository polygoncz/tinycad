// Operations of spec 04 ↔ the messages of operations.proto (spec 14 "Operace", Q101). Fields go
// 1:1 (camelCase on both sides), `v` does not travel: the wire always carries the current version
// and operationFromProto sets OP_VERSION of the type. The domain never sees a protobuf message
// (Q106).

import { create } from '@bufbuild/protobuf';
import type { JsonObject, MessageInitShape } from '@bufbuild/protobuf';
import { assert } from '@/core';
import { isBodyMaterial, isJsonObject } from '@/document';
import type {
  BodyId,
  BodyMaterial as DomainBodyMaterial,
  FeatureId,
  FeatureInstance,
} from '@/document';
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
  Operation,
  StudioSetRollbackOp,
} from '@/ops';
import { BodyMaterial, FeatureInstanceSchema, OperationSchema } from '@/protocol';
import type {
  FeatureInstance as ProtoFeatureInstance,
  Operation as ProtoOperation,
} from '@/protocol';

/** Every operation type of spec 04 with its payload. */
type KnownOperation =
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

const MATERIALS_TO_PROTO: Readonly<Record<DomainBodyMaterial, BodyMaterial>> = Object.freeze({
  plastic: BodyMaterial.PLASTIC,
  aluminium: BodyMaterial.ALUMINIUM,
  steel: BodyMaterial.STEEL,
  brass: BodyMaterial.BRASS,
  glass: BodyMaterial.GLASS,
  rubber: BodyMaterial.RUBBER,
});

/**
 * An operation → the message Operation. Its payload has the shape of its type (interaction builds
 * it by the types of ops; the server validates it, ADR 0031); an unknown type or params that are
 * no JSON object are a bug of the caller (assert).
 */
export function operationToProto(op: Operation): ProtoOperation {
  // The type decides the payload, as the handlers of the server read it.
  const known = op as KnownOperation;
  switch (known.type) {
    case 'feature.add':
      return message({
        case: 'featureAdd',
        value: { feature: featureToProto(known.feature), index: known.index },
      });
    case 'feature.remove':
      return message({ case: 'featureRemove', value: { featureId: known.featureId } });
    case 'feature.setParams':
      return message({
        case: 'featureSetParams',
        value: {
          featureId: known.featureId,
          typeVersion: known.typeVersion,
          params: jsonObject(known.params, 'feature.setParams params'),
        },
      });
    case 'feature.rename':
      return message({
        case: 'featureRename',
        value: { featureId: known.featureId, name: known.name },
      });
    case 'feature.suppress':
      return message({
        case: 'featureSuppress',
        value: { featureId: known.featureId, suppressed: known.suppressed },
      });
    case 'feature.move':
      return message({
        case: 'featureMove',
        value: { featureId: known.featureId, toIndex: known.toIndex },
      });
    case 'studio.setRollback':
      return message({ case: 'studioSetRollback', value: { index: known.index } });
    case 'body.rename':
      return message({ case: 'bodyRename', value: { bodyId: known.body, name: known.name } });
    case 'body.setVisible':
      return message({
        case: 'bodySetVisible',
        value: { bodyId: known.body, visible: known.visible },
      });
    case 'body.setColor':
      return message({
        case: 'bodySetColor',
        value: { bodyId: known.body, ...(known.color === null ? {} : { color: known.color }) },
      });
    case 'body.setMaterial':
      return message({
        case: 'bodySetMaterial',
        value: { bodyId: known.body, material: MATERIALS_TO_PROTO[known.material] },
      });
    case 'document.rename':
      return message({ case: 'documentRename', value: { name: known.name } });
    case 'batch':
      return message({ case: 'batch', value: { ops: known.ops.map(operationToProto) } });
    default:
      throw new Error(`Operation '${op.type}' has no message in operations.proto`);
  }
}

/**
 * The message Operation → an operation with the current `v` of its type. Missing params are {}.
 * A message without an operation or with BODY_MATERIAL_UNSPECIFIED is a broken message (it can
 * only come from a bug, the client never sends one): an Error.
 */
export function operationFromProto(msg: ProtoOperation): Operation {
  const { op } = msg;
  switch (op.case) {
    case 'featureAdd': {
      const value: FeatureAddOp = {
        type: 'feature.add',
        v: OP_VERSION['feature.add'],
        feature: featureFromProto(op.value.feature),
        index: op.value.index,
      };
      return value;
    }
    case 'featureRemove': {
      const value: FeatureRemoveOp = {
        type: 'feature.remove',
        v: OP_VERSION['feature.remove'],
        featureId: featureId(op.value.featureId),
      };
      return value;
    }
    case 'featureSetParams': {
      const value: FeatureSetParamsOp = {
        type: 'feature.setParams',
        v: OP_VERSION['feature.setParams'],
        featureId: featureId(op.value.featureId),
        typeVersion: op.value.typeVersion,
        params: op.value.params ?? {},
      };
      return value;
    }
    case 'featureRename': {
      const value: FeatureRenameOp = {
        type: 'feature.rename',
        v: OP_VERSION['feature.rename'],
        featureId: featureId(op.value.featureId),
        name: op.value.name,
      };
      return value;
    }
    case 'featureSuppress': {
      const value: FeatureSuppressOp = {
        type: 'feature.suppress',
        v: OP_VERSION['feature.suppress'],
        featureId: featureId(op.value.featureId),
        suppressed: op.value.suppressed,
      };
      return value;
    }
    case 'featureMove': {
      const value: FeatureMoveOp = {
        type: 'feature.move',
        v: OP_VERSION['feature.move'],
        featureId: featureId(op.value.featureId),
        toIndex: op.value.toIndex,
      };
      return value;
    }
    case 'studioSetRollback': {
      const value: StudioSetRollbackOp = {
        type: 'studio.setRollback',
        v: OP_VERSION['studio.setRollback'],
        index: op.value.index,
      };
      return value;
    }
    case 'bodyRename': {
      const value: BodyRenameOp = {
        type: 'body.rename',
        v: OP_VERSION['body.rename'],
        body: bodyId(op.value.bodyId),
        name: op.value.name,
      };
      return value;
    }
    case 'bodySetVisible': {
      const value: BodySetVisibleOp = {
        type: 'body.setVisible',
        v: OP_VERSION['body.setVisible'],
        body: bodyId(op.value.bodyId),
        visible: op.value.visible,
      };
      return value;
    }
    case 'bodySetColor': {
      const value: BodySetColorOp = {
        type: 'body.setColor',
        v: OP_VERSION['body.setColor'],
        body: bodyId(op.value.bodyId),
        color: op.value.color ?? null,
      };
      return value;
    }
    case 'bodySetMaterial': {
      const value: BodySetMaterialOp = {
        type: 'body.setMaterial',
        v: OP_VERSION['body.setMaterial'],
        body: bodyId(op.value.bodyId),
        material: materialFromProto(op.value.material),
      };
      return value;
    }
    case 'documentRename': {
      const value: DocumentRenameOp = {
        type: 'document.rename',
        v: OP_VERSION['document.rename'],
        name: op.value.name,
      };
      return value;
    }
    case 'batch': {
      const value: BatchOp = {
        type: 'batch',
        v: OP_VERSION.batch,
        ops: op.value.ops.map(operationFromProto),
      };
      return value;
    }
    case undefined:
      throw new Error('The message Operation has no operation');
  }
}

/** A feature of the document → the message FeatureInstance. */
export function featureToProto(feature: FeatureInstance): ProtoFeatureInstance {
  return create(FeatureInstanceSchema, {
    id: feature.id,
    type: feature.type,
    typeVersion: feature.typeVersion,
    name: feature.name,
    suppressed: feature.suppressed,
    params: jsonObject(feature.params, `params of feature '${feature.id}'`),
  });
}

/** The message FeatureInstance → a feature of the document; missing params are {}. */
export function featureFromProto(feature: ProtoFeatureInstance | undefined): FeatureInstance {
  if (feature === undefined) throw new Error('The message FeatureAdd has no feature');
  return {
    id: featureId(feature.id),
    type: feature.type,
    typeVersion: feature.typeVersion,
    name: feature.name,
    params: feature.params ?? {},
    suppressed: feature.suppressed,
  };
}

/** An id of the server as a FeatureId: the core mints the same strings as the domain. */
export function featureId(id: string): FeatureId {
  return id as FeatureId; // ids from the server are the ids of the document (spec 14)
}

/** An id of the server as a BodyId: the core mints the same strings as the domain (ADR 0015). */
export function bodyId(id: string): BodyId {
  return id as BodyId; // ids from the server are the ids of the document (spec 14)
}

/** The material enum → a material of the document; UNSPECIFIED or unknown is a broken message. */
export function materialFromProto(material: BodyMaterial): DomainBodyMaterial {
  const entry = Object.entries(MATERIALS_TO_PROTO).find(([, value]) => value === material);
  const name = entry?.[0];
  if (!isBodyMaterial(name)) {
    throw new Error(`The material ${String(material)} is no material of the document`);
  }
  return name;
}

function message(op: NonNullable<MessageInitShape<typeof OperationSchema>['op']>): ProtoOperation {
  return create(OperationSchema, { op });
}

function jsonObject(value: unknown, what: string): JsonObject {
  assert(isJsonObject(value), `${what} must be a JSON object`);
  return value as JsonObject; // isJsonObject checked every value to be plain JSON
}
