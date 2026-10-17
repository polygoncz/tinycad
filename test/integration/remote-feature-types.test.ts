// FeatureTypeDescriptor → FeatureSchema (M46 task 1, N67) against the golden file of the core
// (N75): descriptors of box and extrude written by hand as spec 14 "Schéma featur" describes them
// give the same ParamSpec, defaults and validation as the descriptors the C++ core writes, and the
// visibleWhen of extrude gives the same visibility over the shared cases schema.visibleWhen. Since
// M47 the TS schemas of the plugins are gone (N123), so the golden file is the reference.

import { describe, expect, it } from 'vitest';
import { isParamVisible } from '@/document';
import type { FeatureSchema, ParamSpec } from '@/document';
import { TopoParam_Entity } from '@/protocol';
import { aFeatureTypeDescriptor, featureSchemaOf, listValue } from '@/remote/testing';
import { loadCases } from './shared-cases/support/case';
import { builtInSchemas } from './shared-cases/support/schemas';

const BOX = aFeatureTypeDescriptor({
  type: 'box',
  version: 1,
  label: 'box.label',
  icon: 'box',
  params: [
    {
      key: 'origin',
      label: 'box.origin',
      spec: { case: 'point', value: { defaultValue: { x: 0, y: 0, z: 0 } } },
    },
    ...['width', 'depth', 'height'].map((key) => ({
      key,
      label: `box.${key}`,
      spec: {
        case: 'length' as const,
        value: { defaultValue: 10, min: 0, exclusiveMin: true },
      },
    })),
  ],
  defaults: { origin: [0, 0, 0], width: 10, depth: 10, height: 10 },
});

const EXTRUDE = aFeatureTypeDescriptor({
  type: 'extrude',
  version: 1,
  label: 'extrude.label',
  icon: 'arrow-big-up-lines',
  params: [
    { key: 'regions', label: 'extrude.regions', spec: { case: 'region', value: { min: 1 } } },
    {
      key: 'operation',
      label: 'extrude.operation',
      spec: {
        case: 'enumeration',
        value: {
          defaultValue: 'new',
          options: ['new', 'add', 'remove', 'intersect'].map((v) => ({
            value: v,
            label: `extrude.operation.${v}`,
          })),
        },
      },
    },
    {
      key: 'targets',
      label: 'extrude.targets',
      group: 'extrude.group.merge',
      visibleWhen: { param: 'operation', test: { case: 'equalsNone', value: listValue(['new']) } },
      spec: { case: 'bodies', value: { min: 1 } },
    },
    {
      key: 'endType',
      label: 'extrude.endType',
      spec: {
        case: 'enumeration',
        value: {
          defaultValue: 'blind',
          options: ['blind', 'symmetric', 'upToFace'].map((v) => ({
            value: v,
            label: `extrude.endType.${v}`,
          })),
        },
      },
    },
    {
      key: 'distance',
      label: 'extrude.distance',
      visibleWhen: {
        param: 'endType',
        test: { case: 'equalsNone', value: listValue(['upToFace']) },
      },
      spec: { case: 'length', value: { defaultValue: 10, min: 0, exclusiveMin: true } },
    },
    {
      key: 'upTo',
      label: 'extrude.upTo',
      visibleWhen: {
        param: 'endType',
        test: { case: 'equalsAny', value: listValue(['upToFace']) },
      },
      spec: { case: 'topo', value: { entity: TopoParam_Entity.FACE, min: 1, max: 1 } },
    },
    {
      key: 'flip',
      label: 'extrude.flip',
      visibleWhen: { param: 'endType', test: { case: 'equalsAny', value: listValue(['blind']) } },
      spec: { case: 'boolean', value: { defaultValue: false } },
    },
  ],
  defaults: {
    regions: [],
    operation: 'new',
    targets: [],
    endType: 'blind',
    distance: 10,
    upTo: [],
    flip: false,
  },
});

/** A ParamSpec without its predicate: visibleWhen is compared by evaluation. */
function withoutPredicate(spec: ParamSpec): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(spec).filter(([key]) => key !== 'visibleWhen'));
}

/** The comparable part of a schema: everything but the functions. */
function shapeOf(schema: FeatureSchema) {
  return {
    type: schema.type,
    version: schema.version,
    label: schema.label,
    icon: schema.icon,
    keys: Object.keys(schema.params),
    params: Object.fromEntries(
      Object.entries(schema.params).map(([key, spec]) => [key, withoutPredicate(spec)]),
    ),
    visible: Object.entries(schema.params)
      .filter(([, spec]) => spec.visibleWhen !== undefined)
      .map(([key]) => key),
    defaults: schema.defaults(),
  };
}

const schemas = builtInSchemas();

describe.each([
  ['box', BOX],
  ['extrude', EXTRUDE],
])('featureSchemaOf the descriptor of %s', (type, descriptor) => {
  const today = schemas.get(type);
  const remote = featureSchemaOf(descriptor);

  it('gives the ParamSpec, defaults and metadata of the descriptor of the core', () => {
    expect(shapeOf(remote)).toEqual(shapeOf(today));
  });

  it('validates like the descriptor of the core', () => {
    for (const raw of [today.defaults(), {}, { width: 0 }, { endType: 'upToFace' }, 7]) {
      expect(remote.validate(raw)).toEqual(today.validate(raw));
    }
  });
});

describe('visibleWhen of the descriptor of extrude', () => {
  const remote = featureSchemaOf(EXTRUDE);
  const cases = loadCases('schema', { requireExpected: true }).filter(
    (c) => c.kind === 'schema.visibleWhen' && c.name.startsWith('visible-when-extrude-'),
  );

  it('has shared cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    // The input of schema.visibleWhen ({ type, param, params }); the runner of the area checks it.
    const input = c.input as { param: string; params: Readonly<Record<string, unknown>> };
    const spec = remote.params[input.param];
    expect(spec).toBeDefined();
    expect({ ok: { visible: spec !== undefined && isParamVisible(spec, input.params) } }).toEqual(
      c.expected,
    );
  });
});
