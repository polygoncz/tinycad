// FeatureTypeDescriptor of the core (schema.proto, spec 14 "Schéma featur", Q098, Q105) →
// FeatureSchema of document (N67): the params with a ParamSpec of the same shape as the schemas of
// the plugins, visibleWhen as a function over the data, defaults() a copy of the defaults and
// validate the generic validateAgainstSchema. No migrate: the server migrates features; the rules
// of a feature beyond the generic ones come back as a red feature in the read model.

import { toJson } from '@bufbuild/protobuf';
import type { JsonValue } from '@bufbuild/protobuf';
import { ListValueSchema } from '@bufbuild/protobuf/wkt';
import type { Vec3 } from '@/core';
import { validateAgainstSchema } from '@/document';
import type { FeatureSchema, ParamSchema, ParamSpec } from '@/document';
import { TopoParam_Entity } from '@/protocol';
import type {
  FeatureTypeDescriptor,
  NumberParam,
  ParamDescriptor,
  RefListParam,
  VisibleWhen,
} from '@/protocol';
import { decoding } from './errors';

type Params = Readonly<Record<string, unknown>>;

/**
 * The schema of a feature type from its descriptor. Frozen; `icon` only when not empty, `group`
 * of a param only when not empty, bounds and `integer` only when set. A param without a kind is a
 * broken answer: RemoteError INTERNAL.
 */
export function featureSchemaOf(descriptor: FeatureTypeDescriptor): FeatureSchema {
  return decoding(`descriptor of '${descriptor.type}'`, () => {
    const params: Record<string, ParamSpec> = {};
    for (const param of descriptor.params) params[param.key] = paramSpecOf(param);
    const frozen: ParamSchema = Object.freeze(params);
    const defaults = descriptor.defaults ?? {};
    return Object.freeze({
      type: descriptor.type,
      version: descriptor.version,
      label: descriptor.label,
      ...(descriptor.icon === '' ? {} : { icon: descriptor.icon }),
      params: frozen,
      defaults: (): unknown => structuredClone(defaults),
      validate: (raw: unknown) => validateAgainstSchema(frozen, raw),
    });
  });
}

/**
 * VisibleWhen → the predicate of ParamSpec.visibleWhen over the unchecked params (Q105, the same
 * rule as the C++ core and the shared cases schema.visibleWhen):
 * - equals_any: visible when the value equals one of the values;
 * - equals_none: visible when the value is missing, or has the type of one of the values and
 *   equals none of them (a value of another type hides);
 * - less_than: visible when the value is a number below the bound.
 * Values are compared as JSON primitives (===); an array or an object never equals. Without a
 * test the param is always visible.
 */
export function visibleWhenOf(data: VisibleWhen): (params: Params) => boolean {
  const { param, test } = data;
  switch (test.case) {
    case 'equalsAny': {
      const values = listOf(test.value);
      return (p) => values.some((v) => v === p[param]);
    }
    case 'equalsNone': {
      const values = listOf(test.value);
      const types = new Set(values.map(jsonType));
      return (p) => {
        const value = p[param];
        if (value === undefined) return true;
        return types.has(jsonType(value)) && !values.some((v) => v === value);
      };
    }
    case 'lessThan': {
      const bound = test.value;
      return (p) => {
        const value = p[param];
        return typeof value === 'number' && value < bound;
      };
    }
    case undefined:
      return () => true;
  }
}

function paramSpecOf(param: ParamDescriptor): ParamSpec {
  const common = {
    label: param.label,
    ...(param.group === '' ? {} : { group: param.group }),
    ...(param.visibleWhen === undefined ? {} : { visibleWhen: visibleWhenOf(param.visibleWhen) }),
  };
  const { spec } = param;
  switch (spec.case) {
    case 'length':
    case 'angle':
      return Object.freeze({ kind: spec.case, ...common, ...numberOf(spec.value) });
    case 'number':
      return Object.freeze({
        kind: 'number',
        ...common,
        ...numberOf(spec.value),
        ...(spec.value.integer ? { integer: true } : {}),
      });
    case 'boolean':
      return Object.freeze({ kind: 'boolean', ...common, default: spec.value.defaultValue });
    case 'enumeration':
      return Object.freeze({
        kind: 'enum',
        ...common,
        default: spec.value.defaultValue,
        options: Object.freeze(
          spec.value.options.map((o) => Object.freeze({ value: o.value, label: o.label })),
        ),
      });
    case 'point': {
      const v = spec.value.defaultValue;
      const point: Vec3 = v === undefined ? [0, 0, 0] : [v.x, v.y, v.z];
      return Object.freeze({ kind: 'point', ...common, default: Object.freeze(point) });
    }
    case 'data':
      return Object.freeze({ kind: 'data', ...common });
    case 'bodies':
    case 'region':
    case 'planes':
      return Object.freeze({ kind: spec.case, ...common, ...countOf(spec.value) });
    case 'topo':
      return Object.freeze({
        kind: 'topo',
        ...common,
        entity: entityOf(spec.value.entity),
        ...countOf(spec.value),
      });
    case 'axis':
      return Object.freeze({ kind: 'axis', ...common });
    case undefined:
      throw new Error(`param '${param.key}' has no kind`);
  }
}

/** default and the bounds that are set (Q050). */
function numberOf(n: NumberParam): {
  readonly default: number;
  readonly min?: number;
  readonly max?: number;
  readonly exclusiveMin?: boolean;
  readonly exclusiveMax?: boolean;
} {
  return {
    default: n.defaultValue,
    ...(n.min === undefined ? {} : { min: n.min }),
    ...(n.max === undefined ? {} : { max: n.max }),
    ...(n.exclusiveMin ? { exclusiveMin: true } : {}),
    ...(n.exclusiveMax ? { exclusiveMax: true } : {}),
  };
}

/** The count bounds of a list of references that are set. */
function countOf(r: Pick<RefListParam, 'min' | 'max'>): {
  readonly min?: number;
  readonly max?: number;
} {
  return {
    ...(r.min === undefined ? {} : { min: r.min }),
    ...(r.max === undefined ? {} : { max: r.max }),
  };
}

function entityOf(entity: TopoParam_Entity): 'face' | 'edge' | 'vertex' {
  switch (entity) {
    case TopoParam_Entity.FACE:
      return 'face';
    case TopoParam_Entity.EDGE:
      return 'edge';
    case TopoParam_Entity.VERTEX:
      return 'vertex';
    default:
      throw new Error(`topo entity ${String(entity)} is unknown`);
  }
}

function listOf(list: Parameters<typeof toJson<typeof ListValueSchema>>[1]): readonly JsonValue[] {
  const json = toJson(ListValueSchema, list);
  return Array.isArray(json) ? json : [];
}

/** The JSON type of a value: 'null', 'array' or typeof. */
function jsonType(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}
