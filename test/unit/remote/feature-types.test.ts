import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { create, fromJson } from '@bufbuild/protobuf';
import type { JsonValue } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { isParamVisible, validateAgainstSchema } from '@/document';
import type { FeatureSchema } from '@/document';
import { FeatureTypeDescriptorSchema, TopoParam_Entity, VisibleWhenSchema } from '@/protocol';
import type { FeatureTypeDescriptor } from '@/protocol';
import { featureSchemaOf, RemoteError, visibleWhenOf } from '@/remote';
import { aFeatureTypeDescriptor, listValue } from '@/remote/testing';

const SHARED_CASES = join(import.meta.dirname, '../../shared-cases/schema');
// The golden file written by the C++ tests (N88, N95).
const GOLDEN = join(import.meta.dirname, '../../golden/feature-types.json');

/** One descriptor with a param of every kind of ParamDescriptor.spec. */
const EVERY_KIND = aFeatureTypeDescriptor({
  type: 'every',
  version: 1,
  label: 'every.label',
  icon: '',
  params: [
    {
      key: 'len',
      label: 'every.len',
      group: 'every.group.size',
      spec: { case: 'length', value: { defaultValue: 10, min: 0, exclusiveMin: true } },
    },
    {
      key: 'ang',
      label: 'every.ang',
      spec: { case: 'angle', value: { defaultValue: 1, min: 0, max: 6, exclusiveMax: true } },
    },
    {
      key: 'count',
      label: 'every.count',
      spec: { case: 'number', value: { defaultValue: 3, min: 1, integer: true } },
    },
    { key: 'free', label: 'every.free', spec: { case: 'number', value: { defaultValue: 0.5 } } },
    { key: 'flag', label: 'every.flag', spec: { case: 'boolean', value: { defaultValue: true } } },
    {
      key: 'mode',
      label: 'every.mode',
      spec: {
        case: 'enumeration',
        value: {
          defaultValue: 'a',
          options: [
            { value: 'a', label: 'every.mode.a' },
            { value: 'b', label: 'every.mode.b' },
          ],
        },
      },
    },
    {
      key: 'at',
      label: 'every.at',
      spec: { case: 'point', value: { defaultValue: { x: 1, y: 2, z: 3 } } },
    },
    { key: 'blob', label: 'every.blob', spec: { case: 'data', value: {} } },
    { key: 'targets', label: 'every.targets', spec: { case: 'bodies', value: { min: 1 } } },
    {
      key: 'edges',
      label: 'every.edges',
      spec: { case: 'topo', value: { entity: TopoParam_Entity.EDGE, min: 1, max: 4 } },
    },
    { key: 'regions', label: 'every.regions', spec: { case: 'region', value: {} } },
    { key: 'on', label: 'every.on', spec: { case: 'planes', value: { min: 1, max: 1 } } },
    { key: 'axis', label: 'every.axis', spec: { case: 'axis', value: {} } },
  ],
  defaults: { len: 10, mode: 'a', nested: { list: [1, 2] } },
});

describe('featureSchemaOf', () => {
  const schema = featureSchemaOf(EVERY_KIND);

  it('takes type, version and label; no icon for an empty one and no migrate', () => {
    expect(schema.type).toBe('every');
    expect(schema.version).toBe(1);
    expect(schema.label).toBe('every.label');
    expect(schema).not.toHaveProperty('icon');
    expect('migrate' in schema).toBe(false);
    expect(featureSchemaOf(aFeatureTypeDescriptor({ icon: 'box' })).icon).toBe('box');
  });

  it('keeps the params in the order of the descriptor', () => {
    expect(Object.keys(schema.params)).toEqual(EVERY_KIND.params.map((p) => p.key));
  });

  it('gives every kind the ParamSpec of the schemas of plugins', () => {
    expect(schema.params).toEqual({
      len: {
        kind: 'length',
        label: 'every.len',
        group: 'every.group.size',
        default: 10,
        min: 0,
        exclusiveMin: true,
      },
      ang: { kind: 'angle', label: 'every.ang', default: 1, min: 0, max: 6, exclusiveMax: true },
      count: { kind: 'number', label: 'every.count', default: 3, min: 1, integer: true },
      free: { kind: 'number', label: 'every.free', default: 0.5 },
      flag: { kind: 'boolean', label: 'every.flag', default: true },
      mode: {
        kind: 'enum',
        label: 'every.mode',
        default: 'a',
        options: [
          { value: 'a', label: 'every.mode.a' },
          { value: 'b', label: 'every.mode.b' },
        ],
      },
      at: { kind: 'point', label: 'every.at', default: [1, 2, 3] },
      blob: { kind: 'data', label: 'every.blob' },
      targets: { kind: 'bodies', label: 'every.targets', min: 1 },
      edges: { kind: 'topo', label: 'every.edges', entity: 'edge', min: 1, max: 4 },
      regions: { kind: 'region', label: 'every.regions' },
      on: { kind: 'planes', label: 'every.on', min: 1, max: 1 },
      axis: { kind: 'axis', label: 'every.axis' },
    });
  });

  it('freezes the schema and its params', () => {
    expect(Object.isFrozen(schema)).toBe(true);
    expect(Object.isFrozen(schema.params)).toBe(true);
    expect(Object.isFrozen(schema.params['mode'])).toBe(true);
  });

  it('defaults() gives a new copy of the defaults every time', () => {
    const a = schema.defaults();
    const b = schema.defaults();
    expect(a).toEqual({ len: 10, mode: 'a', nested: { list: [1, 2] } });
    expect(a).not.toBe(b);
    expect(featureSchemaOf(aFeatureTypeDescriptor({ defaults: undefined })).defaults()).toEqual({});
  });

  it('validate is validateAgainstSchema over the params', () => {
    for (const raw of [
      schema.defaults(),
      { len: -1 },
      'not an object',
      { len: 10, count: 2.5, mode: 'c', flag: 'yes' },
    ]) {
      expect(schema.validate(raw)).toEqual(validateAgainstSchema(schema.params, raw));
    }
  });

  it('refuses a param without a kind as a broken answer', () => {
    const broken = aFeatureTypeDescriptor({ params: [{ key: 'x', label: 'x' }] });
    expect(() => featureSchemaOf(broken)).toThrow(RemoteError);
  });

  it('a param with visible_when gets a visibleWhen, one without none', () => {
    const s = featureSchemaOf(
      aFeatureTypeDescriptor({
        params: [
          { key: 'mode', label: 'm', spec: { case: 'enumeration', value: { defaultValue: 'a' } } },
          {
            key: 'size',
            label: 's',
            visibleWhen: { param: 'mode', test: { case: 'equalsAny', value: listValue(['b']) } },
            spec: { case: 'length', value: { defaultValue: 1 } },
          },
        ],
      }),
    );
    expect(s.params['mode']).not.toHaveProperty('visibleWhen');
    expect(isParamVisible(s.params['size'] ?? fail(), { mode: 'b' })).toBe(true);
    expect(isParamVisible(s.params['size'] ?? fail(), { mode: 'a' })).toBe(false);
  });
});

describe('visibleWhenOf', () => {
  const test = (init: Parameters<typeof create<typeof VisibleWhenSchema>>[1]) =>
    visibleWhenOf(create(VisibleWhenSchema, init));

  it('equals_any: visible for one of the values only', () => {
    const p = test({ param: 'pivot', test: { case: 'equalsAny', value: listValue(['point']) } });
    expect(p({ pivot: 'point' })).toBe(true);
    expect(p({ pivot: 'origin' })).toBe(false);
    expect(p({ pivot: ['point'] })).toBe(false);
    expect(p({})).toBe(false);
  });

  it('equals_none: hidden for the values and for another type, visible when missing', () => {
    const p = test({ param: 'operation', test: { case: 'equalsNone', value: listValue(['new']) } });
    expect(p({ operation: 'new' })).toBe(false);
    expect(p({ operation: 'add' })).toBe(true);
    expect(p({ operation: 0 })).toBe(false);
    expect(p({ operation: null })).toBe(false);
    expect(p({})).toBe(true);
  });

  it('equals_any and equals_none compare numbers and booleans too', () => {
    const any = test({ param: 'n', test: { case: 'equalsAny', value: listValue([2, true]) } });
    expect(any({ n: 2 })).toBe(true);
    expect(any({ n: true })).toBe(true);
    expect(any({ n: '2' })).toBe(false);
    const none = test({ param: 'n', test: { case: 'equalsNone', value: listValue([2]) } });
    expect(none({ n: 3 })).toBe(true);
    expect(none({ n: 2 })).toBe(false);
    expect(none({ n: '3' })).toBe(false);
  });

  it('less_than: visible for a number below the bound only', () => {
    const p = test({ param: 'angle', test: { case: 'lessThan', value: 2 } });
    expect(p({ angle: 1.5 })).toBe(true);
    expect(p({ angle: 2 })).toBe(false);
    expect(p({ angle: 3 })).toBe(false);
    expect(p({ angle: '1' })).toBe(false);
    expect(p({})).toBe(false);
  });

  it('without a test always visible', () => {
    expect(test({ param: 'x' })({})).toBe(true);
  });
});

interface VisibleWhenCase {
  readonly name: string;
  readonly type: string;
  readonly param: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly visible: boolean;
}

/** The shared cases schema.visibleWhen (spec 13), read without the runner of the integration. */
function visibleWhenCases(): readonly VisibleWhenCase[] {
  return readdirSync(SHARED_CASES)
    .filter((file) => file.startsWith('visible-when-') && file.endsWith('.json'))
    .map((file) => {
      // The envelope of spec 13; the integration runner checks its shape.
      const c = JSON.parse(readFileSync(join(SHARED_CASES, file), 'utf8')) as {
        input: { type: string; param: string; params: Record<string, unknown> };
        expected: { ok: { visible: boolean } };
      };
      return { name: file, ...c.input, visible: c.expected.ok.visible };
    });
}

/**
 * The descriptors of the golden file of M45 (N75): protobuf JSON of FeatureTypeDescriptor, either
 * a list or an object with the list under feature_types / featureTypes.
 */
function goldenDescriptors(): readonly FeatureTypeDescriptor[] {
  const json = JSON.parse(readFileSync(GOLDEN, 'utf8')) as JsonValue;
  const list =
    Array.isArray(json) || typeof json !== 'object' || json === null
      ? json
      : (json['feature_types'] ?? json['featureTypes']);
  if (!Array.isArray(list)) throw new Error('feature-types.json holds no list of descriptors');
  return list.map((d) => fromJson(FeatureTypeDescriptorSchema, d));
}

describe('golden file of the descriptors of the core (N75)', () => {
  it('gives the same visibility for every shared case schema.visibleWhen as in C++', () => {
    const schemas = new Map<string, FeatureSchema>(
      goldenDescriptors().map((d) => [d.type, featureSchemaOf(d)]),
    );
    const cases = visibleWhenCases();
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const spec = schemas.get(c.type)?.params[c.param];
      expect(spec, `${c.name}: ${c.type}.${c.param}`).toBeDefined();
      expect(isParamVisible(spec ?? fail(), c.params), c.name).toBe(c.visible);
    }
  });
});

function fail(): never {
  throw new Error('missing param');
}
