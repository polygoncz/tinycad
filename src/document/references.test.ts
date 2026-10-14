import { createRegistry } from '@/core';
import type { RegistryReader } from '@/core';
import { describe, expect, it } from 'vitest';
import type { FeatureId, FeatureInstance, PartStudioData } from './model';
import { dependenciesOf, dependentsOf, orderViolations, referencesOf } from './references';
import { ORIGIN_PLANE_IDS } from './origin';
import { bodyId } from './refs';
import type {
  BodyRef,
  EntityRef,
  PlaneId,
  PlaneRef,
  SketchRegionRef,
  TopoName,
  TopoRef,
} from './refs';
import type { FeatureSchema } from './schema';
import { aFeature } from './testing';

const fid = (s: string): FeatureId => s as FeatureId;
const bodyRef = (owner: string, n?: number): BodyRef => ({
  kind: 'body',
  body: bodyId(fid(owner), n),
});
const topoRef = (owner: string, name: string): TopoRef => ({
  kind: 'topo',
  body: bodyId(fid(owner)),
  name: name as TopoName,
});
const regionRef = (sketch: string, region: string): SketchRegionRef => ({
  kind: 'region',
  sketch: fid(sketch),
  region,
});
const planeRef = (plane: string): PlaneRef => ({ kind: 'plane', plane: plane as PlaneId });

// One param of every reference kind plus a plain one, which never yields references.
const schema: FeatureSchema = {
  type: 'op',
  version: 1,
  label: 'op.label',
  params: {
    targets: { kind: 'bodies', label: 'op.targets' },
    faces: { kind: 'topo', label: 'op.faces', entity: 'face' },
    profile: { kind: 'region', label: 'op.profile' },
    plane: { kind: 'planes', label: 'op.plane' },
    sketch: { kind: 'data', label: 'op.sketch' },
    width: { kind: 'length', label: 'op.width', default: 1 },
  },
  defaults: () => ({ targets: [], faces: [], profile: [], plane: [], sketch: {}, width: 1 }),
  validate: () => [],
};

const schemas: RegistryReader<FeatureSchema> = (() => {
  const registry = createRegistry<FeatureSchema>({ what: 'feature schema', keyOf: (s) => s.type });
  registry.register(schema);
  return registry;
})();

interface OpParams {
  readonly targets: readonly EntityRef[];
  readonly faces: readonly EntityRef[];
  readonly profile: readonly EntityRef[];
  readonly plane: readonly EntityRef[];
  readonly sketch: unknown;
  readonly width: number;
}

/** A feature of the test schema; each reference goes to the param of its kind. */
function op(id: string, ...refs: readonly EntityRef[]): FeatureInstance<OpParams> {
  return aFeature({
    id,
    type: 'op',
    params: {
      targets: refs.filter((r) => r.kind === 'body'),
      faces: refs.filter((r) => r.kind === 'topo'),
      profile: refs.filter((r) => r.kind === 'region'),
      plane: refs.filter((r) => r.kind === 'plane'),
      sketch: {},
      width: 1,
    },
  });
}

const studioOf = (...features: readonly FeatureInstance[]): PartStudioData => ({
  features,
  rollbackIndex: features.length,
});

describe('referencesOf', () => {
  it('returns references in schema order, then in array order', () => {
    // Params in a different key order than the schema: the schema decides.
    const params = {
      width: 5,
      profile: [regionRef('s1', 'r1')],
      faces: [topoRef('b', 'Face1'), topoRef('c', 'Face2')],
      targets: [bodyRef('a'), bodyRef('a', 2)],
    };
    expect(referencesOf(schema, params)).toEqual([
      bodyRef('a'),
      bodyRef('a', 2),
      topoRef('b', 'Face1'),
      topoRef('c', 'Face2'),
      regionRef('s1', 'r1'),
    ]);
  });

  it('skips items that are not a valid reference of the param kind', () => {
    const params = {
      targets: [{ kind: 'body' }, bodyRef('a'), topoRef('b', 'Face1'), null, 'a/body'],
      faces: [{ kind: 'topo', body: 'b/body' }, topoRef('b', 'Face1')],
      profile: [{ kind: 'region', sketch: 's1', region: 7 }],
      width: 1,
    };
    expect(referencesOf(schema, params)).toEqual([bodyRef('a'), topoRef('b', 'Face1')]);
  });

  it('skips a reference param whose value is not an array', () => {
    const params = { targets: bodyRef('a'), faces: 'x', profile: [regionRef('s1', 'r1')] };
    expect(referencesOf(schema, params)).toEqual([regionRef('s1', 'r1')]);
  });

  it('skips body and topo references whose id is not <owner>/body[:<n>]', () => {
    const params = {
      targets: [
        { kind: 'body', body: 'nope' },
        { kind: 'body', body: 'a/body:0' },
        bodyRef('a', 3),
      ],
      faces: [{ kind: 'topo', body: 'b', name: 'Face1' }, topoRef('b', 'Face1')],
      profile: [],
      width: 1,
    };
    expect(referencesOf(schema, params)).toEqual([bodyRef('a', 3), topoRef('b', 'Face1')]);
  });

  it('takes plane references of a planes param and nothing from a data param (M12)', () => {
    const params = {
      targets: [],
      faces: [],
      profile: [],
      plane: [planeRef('origin/plane:xz'), { kind: 'plane', plane: 'bad' }, planeRef('f1/plane:1')],
      sketch: [bodyRef('a'), planeRef('origin/plane:xy')],
      width: 1,
    };
    expect(referencesOf(schema, params)).toEqual([
      planeRef('origin/plane:xz'),
      planeRef('f1/plane:1'),
    ]);
  });

  it('returns [] for params that are not an object', () => {
    for (const params of [null, undefined, 3, 'x', [bodyRef('a')]]) {
      expect(referencesOf(schema, params)).toEqual([]);
    }
  });

  it('returns frozen copies', () => {
    const target = bodyRef('a');
    const refs = referencesOf(schema, { targets: [target], faces: [], profile: [], width: 1 });
    expect(Object.isFrozen(refs)).toBe(true);
    expect(refs[0]).toEqual(target);
    expect(refs[0]).not.toBe(target);
    expect(Object.isFrozen(refs[0])).toBe(true);
  });
});

describe('dependenciesOf', () => {
  it('lists the owners of the references once, in order of first occurrence', () => {
    const b = op('b', bodyRef('c'), bodyRef('a'), bodyRef('a', 2), topoRef('c', 'Face1'));
    const deps = dependenciesOf(studioOf(op('a'), op('c'), b), schemas);
    expect(deps.get(fid('b'))).toEqual(['c', 'a']);
  });

  it('has an entry for every feature of the studio, in studio order', () => {
    const deps = dependenciesOf(studioOf(op('a'), op('b', bodyRef('a')), op('c')), schemas);
    expect([...deps.entries()]).toEqual([
      ['a', []],
      ['b', ['a']],
      ['c', []],
    ]);
  });

  it('collects owners of body, topo and region references', () => {
    const studio = studioOf(
      op('a'),
      op('b'),
      op('s'),
      op('x', bodyRef('a'), topoRef('b', 'Edge1'), regionRef('s', 'r1')),
    );
    expect(dependenciesOf(studio, schemas).get(fid('x'))).toEqual(['a', 'b', 's']);
  });

  it('a reference to an origin plane is no dependency (origin is not a feature, M12)', () => {
    const studio = studioOf(op('a'), op('s', planeRef(ORIGIN_PLANE_IDS.xy), bodyRef('a')));
    expect(dependenciesOf(studio, schemas).get(fid('s'))).toEqual(['a']);
  });

  it('leaves out references to features that are not in the studio', () => {
    const studio = studioOf(op('a'), op('b', bodyRef('gone'), bodyRef('a')));
    expect(dependenciesOf(studio, schemas).get(fid('b'))).toEqual(['a']);
  });

  it('leaves out references to the feature itself', () => {
    const studio = studioOf(op('a', bodyRef('a')));
    expect(dependenciesOf(studio, schemas).get(fid('a'))).toEqual([]);
  });

  it('gives [] for an unknown feature type', () => {
    const unknown = aFeature({ id: 'u', type: 'nope', params: { targets: [bodyRef('a')] } });
    const deps = dependenciesOf(studioOf(op('a'), unknown), schemas);
    expect(deps.get(fid('u'))).toEqual([]);
  });

  it('returns frozen dependency lists', () => {
    const deps = dependenciesOf(studioOf(op('a'), op('b', bodyRef('a'))), schemas);
    for (const list of deps.values()) expect(Object.isFrozen(list)).toBe(true);
  });
});

describe('dependentsOf', () => {
  const studio = studioOf(op('a'), op('b', bodyRef('a')), op('c'), op('d', topoRef('a', 'F1')));
  const deps = dependenciesOf(studio, schemas);

  it('lists the features that depend on the id, in map order', () => {
    expect(dependentsOf(deps, fid('a'))).toEqual(['b', 'd']);
  });

  it('gives [] for a feature nobody depends on', () => {
    expect(dependentsOf(deps, fid('c'))).toEqual([]);
  });

  it('returns a frozen list', () => {
    expect(Object.isFrozen(dependentsOf(deps, fid('a')))).toBe(true);
  });
});

describe('orderViolations', () => {
  const violations = (studio: PartStudioData) =>
    orderViolations(studio, dependenciesOf(studio, schemas));

  it('is empty when every dependency comes before its feature', () => {
    expect(violations(studioOf(op('a'), op('b', bodyRef('a'))))).toEqual([]);
  });

  it('reports a feature that refers to a later one', () => {
    expect(violations(studioOf(op('b', bodyRef('a')), op('a')))).toEqual([
      { feature: 'b', dependsOn: 'a' },
    ]);
  });

  it('orders the result by feature, then by dependency', () => {
    const studio = studioOf(
      op('x', bodyRef('c'), bodyRef('b')),
      op('y', bodyRef('c')),
      op('b'),
      op('c'),
    );
    expect(violations(studio)).toEqual([
      { feature: 'x', dependsOn: 'c' },
      { feature: 'x', dependsOn: 'b' },
      { feature: 'y', dependsOn: 'c' },
    ]);
  });

  it('never reports a feature depending on itself (dependenciesOf leaves it out)', () => {
    expect(violations(studioOf(op('a', bodyRef('a'))))).toEqual([]);
  });

  it('returns frozen violations', () => {
    const result = violations(studioOf(op('b', bodyRef('a')), op('a')));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
  });
});
