import { describe, expect, it } from 'vitest';
import { createDocument } from './cad-document';
import type { DocumentId, FeatureId, FeatureInstance } from './model';
import type { BodyId } from './refs';
import { createFeatureSchemaRegistry } from './schema';
import type { FeatureSchema, FeatureSchemaRegistry } from './schema';
import { fromData, migrateFeatureData, toData } from './serialize';
import type { DocumentLoadIssue, FeatureData } from './serialize';

// Box v2 renamed `size` to `width` and dropped `legacy`.
interface BoxV2 {
  readonly width: number;
}
const boxV2: FeatureSchema<BoxV2> = {
  type: 'box',
  version: 2,
  label: 'Box',
  params: { width: { kind: 'length', label: 'Width', default: 10 } },
  defaults: () => ({ width: 10 }),
  validate: () => [],
  migrate(fromVersion, raw) {
    if (fromVersion !== 1) throw new Error(`Unsupported version ${String(fromVersion)}`);
    const { size } = raw as { size: unknown };
    if (typeof size !== 'number') throw new Error('size must be a number');
    return { width: size };
  },
};

function schemas(...list: FeatureSchema[]): FeatureSchemaRegistry {
  const registry = createFeatureSchemaRegistry();
  for (const s of list) registry.register(s);
  return registry;
}

const box = (id: string, width: number): FeatureInstance<BoxV2> => ({
  id: id as FeatureId,
  type: 'box',
  typeVersion: 2,
  name: id,
  params: { width },
  suppressed: false,
});

function sampleDoc() {
  return createDocument({
    meta: { id: 'd1' as DocumentId, name: 'Doc', createdAt: 1_700_000_000_000 },
    studio: { features: [box('a', 1), box('b', 2), box('c', 3)], rollbackIndex: 2 },
  });
}

function rawData(features: unknown[], rollbackIndex = features.length): unknown {
  return { meta: { id: 'd1', name: 'Doc', createdAt: 0 }, studio: { features, rollbackIndex } };
}

function loadIssues(data: unknown, registry = schemas(boxV2)): readonly DocumentLoadIssue[] {
  const result = fromData(data, registry);
  if (result.ok) throw new Error('Expected fromData to fail');
  return result.error.issues;
}

function load(data: unknown, registry = schemas(boxV2)) {
  const result = fromData(data, registry);
  if (!result.ok) throw new Error(`Unexpected issues: ${JSON.stringify(result.error.issues)}`);
  return result.value;
}

describe('toData / fromData round trip', () => {
  it('toData is a cheap snapshot of the immutable data', () => {
    const doc = sampleDoc();
    const data = toData(doc);
    expect(data.studio).toBe(doc.studio);
    expect(Object.isFrozen(data)).toBe(true);
    doc.removeFeature('a' as FeatureId);
    expect(data.studio.features).toHaveLength(3);
  });

  it('survives JSON: JSON.parse(JSON.stringify(data)) deep-equals data', () => {
    const data = toData(sampleDoc());
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it('fromData(toData(doc)) is equivalent and toData → fromData → toData is the identity', () => {
    const data = toData(sampleDoc());
    const loaded = load(JSON.parse(JSON.stringify(data)));
    expect(toData(loaded)).toEqual(data);
    expect(Object.isFrozen(loaded.studio.features[0]?.params)).toBe(true);
  });

  it('keeps body metadata through JSON', () => {
    const doc = sampleDoc();
    doc.setBodyMeta('a/body' as BodyId, { name: 'Base', hidden: true });
    const data = toData(doc);
    expect(toData(load(JSON.parse(JSON.stringify(data))))).toEqual(data);
  });
});

describe('fromData – body metadata (M11)', () => {
  const withBodies = (bodies: unknown): unknown => ({
    meta: { id: 'd1', name: 'Doc', createdAt: 0 },
    studio: { features: [], rollbackIndex: 0, bodies },
  });

  it('loads a studio without bodies without metadata', () => {
    expect('bodies' in load(rawData([])).studio).toBe(false);
  });

  it('loads valid metadata, frozen', () => {
    const doc = load(
      withBodies({ 'a/body': { name: 'Base' }, 'b/body:2': { hidden: true, name: 'B' } }),
    );
    expect(doc.studio.bodies).toEqual({
      'a/body': { name: 'Base' },
      'b/body:2': { name: 'B', hidden: true },
    });
    expect(doc.bodyMeta('b/body:2' as BodyId)).toEqual({ name: 'B', hidden: true });
    expect(Object.isFrozen(doc.studio.bodies)).toBe(true);
    expect(Object.isFrozen(doc.studio.bodies?.['a/body' as BodyId])).toBe(true);
  });

  it('drops hidden: false, empty entries and an empty map (canonical form)', () => {
    expect(load(withBodies({ 'a/body': { name: 'A', hidden: false } })).studio.bodies).toEqual({
      'a/body': { name: 'A' },
    });
    const empty = load(withBodies({ 'a/body': { hidden: false }, 'b/body': {} }));
    expect('bodies' in empty.studio).toBe(false);
    expect('bodies' in load(withBodies({})).studio).toBe(false);
  });

  it.each([[null], [[]], ['x'], [3]])('reports bodies %j that is not an object', (bodies) => {
    expect(loadIssues(withBodies(bodies)).map((i) => i.path)).toEqual(['studio.bodies']);
  });

  it.each(['a', 'a/', '/body', 'a/body:0', 'a/body:x', 'a/sketch', 'a/b/body'])(
    'reports the key %j that is not a body id',
    (key) => {
      expect(loadIssues(withBodies({ [key]: { name: 'A' } })).map((i) => i.path)).toEqual([
        `studio.bodies['${key}']`,
      ]);
    },
  );

  it.each([
    ['not an object', null, "studio.bodies['a/body']"],
    ['an array', [], "studio.bodies['a/body']"],
    ['an empty name', { name: '' }, "studio.bodies['a/body'].name"],
    ['a name that is not a string', { name: 3 }, "studio.bodies['a/body'].name"],
    ['hidden that is not a boolean', { hidden: 'yes' }, "studio.bodies['a/body'].hidden"],
    ['a foreign key (Q028)', { name: 'A', color: 'red' }, "studio.bodies['a/body'].color"],
  ])('reports a value that is %s', (_, value, path) => {
    expect(loadIssues(withBodies({ 'a/body': value })).map((i) => i.path)).toEqual([path]);
  });
});

describe('fromData – migration', () => {
  it('loads a version 1 feature through the version 2 schema', () => {
    const v1 = {
      id: 'a',
      type: 'box',
      typeVersion: 1,
      name: 'Box 1',
      params: { size: 5, legacy: true },
      suppressed: false,
    };
    const doc = load(rawData([v1]));
    expect(doc.studio.features[0]).toEqual({ ...v1, typeVersion: 2, params: { width: 5 } });
  });

  it('keeps features that are already current unchanged', () => {
    const doc = load(rawData([box('a', 1)]));
    expect(doc.studio.features[0]).toEqual(box('a', 1));
  });

  it('reports a migration that throws as a load issue', () => {
    const v1 = {
      id: 'a',
      type: 'box',
      typeVersion: 1,
      name: 'Box 1',
      params: { size: 'x' },
      suppressed: false,
    };
    expect(loadIssues(rawData([v1]))).toEqual([
      {
        path: 'studio.features[0].params',
        message: expect.stringContaining('size must be a number') as string,
      },
    ]);
  });

  it('reports a migration that does not return an object', () => {
    const broken: FeatureSchema = { ...boxV2, migrate: () => 42 };
    const v1 = {
      id: 'a',
      type: 'box',
      typeVersion: 1,
      name: 'Box 1',
      params: {},
      suppressed: false,
    };
    expect(loadIssues(rawData([v1]), schemas(broken)).map((i) => i.path)).toEqual([
      'studio.features[0].params',
    ]);
  });

  it('reports a feature newer than its schema (Q025: should not happen)', () => {
    expect(loadIssues(rawData([{ ...box('a', 1), typeVersion: 3 }])).map((i) => i.path)).toEqual([
      'studio.features[0].typeVersion',
    ]);
  });
});

describe('migrateFeatureData', () => {
  const v1 = (params: unknown): FeatureData => ({ type: 'box', typeVersion: 1, params });

  function issue(data: FeatureData, registry = schemas(boxV2)): DocumentLoadIssue {
    const result = migrateFeatureData(registry, data);
    if (result.ok) throw new Error('Expected the migration to fail');
    return result.error;
  }

  it('returns the same object when the data is on the current version', () => {
    const data: FeatureData = { type: 'box', typeVersion: 2, params: { width: 1 } };
    const result = migrateFeatureData(schemas(boxV2), data);
    expect(result.ok && result.value).toBe(data);
  });

  it('migrates an older version through migrate to the schema version', () => {
    expect(migrateFeatureData(schemas(boxV2), v1({ size: 5, legacy: true }))).toEqual({
      ok: true,
      value: { type: 'box', typeVersion: 2, params: { width: 5 } },
    });
  });

  it('keeps an unknown type unchanged, the same object', () => {
    const data: FeatureData = { type: 'teleport', typeVersion: 7, params: { any: 1 } };
    const result = migrateFeatureData(schemas(boxV2), data);
    expect(result.ok && result.value).toBe(data);
  });

  it('reports a version newer than the schema at typeVersion', () => {
    expect(issue({ type: 'box', typeVersion: 3, params: {} })).toEqual({
      path: 'typeVersion',
      message: expect.stringContaining('newer') as string,
    });
  });

  it('reports a migrate that throws at params', () => {
    expect(issue(v1({ size: 'x' }))).toEqual({
      path: 'params',
      message: expect.stringContaining('size must be a number') as string,
    });
  });

  it.each([
    ['a number', 42],
    ['an array', [1]],
    ['null', null],
    ['a Date inside', { at: new Date(0) }],
  ])('reports a migrate returning %s at params', (_, result) => {
    const broken: FeatureSchema = { ...boxV2, migrate: () => result };
    expect(issue(v1({}), schemas(broken)).path).toBe('params');
  });
});

describe('fromData – unknown feature types', () => {
  it('keeps them unchanged and does not break the document', () => {
    const unknown = {
      id: 'u',
      type: 'teleport',
      typeVersion: 7,
      name: 'Mystery',
      params: { any: ['thing'] },
      suppressed: false,
    };
    const doc = load(rawData([box('a', 1), unknown]));
    expect(doc.studio.features[1]).toEqual(unknown);
    expect(toData(doc).studio.features[1]).toEqual(unknown);
  });
});

describe('fromData – broken data (Q026)', () => {
  it('rejects data that is not an object', () => {
    expect(loadIssues(null)).toEqual([{ path: '', message: 'Document data must be an object' }]);
  });

  it('reports bad meta fields with their paths', () => {
    const data = { meta: { id: '', name: 3 }, studio: { features: [], rollbackIndex: 0 } };
    expect(loadIssues(data).map((i) => i.path)).toEqual(['meta.id', 'meta.name', 'meta.createdAt']);
  });

  it("rejects a feature id with '/': it is the owner part of artifact ids", () => {
    expect(loadIssues(rawData([box('a/b', 1)])).map((i) => i.path)).toEqual([
      'studio.features[0].id',
    ]);
  });

  it('reports every bad feature field with its path', () => {
    const bad = { id: 7, type: '', typeVersion: 0, name: null, params: [], suppressed: 'no' };
    expect(loadIssues(rawData([box('a', 1), bad])).map((i) => i.path)).toEqual([
      'studio.features[1].id',
      'studio.features[1].type',
      'studio.features[1].typeVersion',
      'studio.features[1].name',
      'studio.features[1].params',
      'studio.features[1].suppressed',
    ]);
  });

  it.each([
    ['a Date', { at: new Date(0) }],
    ['a Map', { m: new Map() }],
    ['undefined', { x: undefined }],
    ['NaN deep inside', { list: [{ v: NaN }] }],
    [
      'a class instance',
      new (class Params {
        width = 1;
      })(),
    ],
  ])('rejects params with %s: they would not survive JSON', (_, params) => {
    expect(loadIssues(rawData([{ ...box('a', 1), params }]))).toEqual([
      { path: 'studio.features[0].params', message: 'Must be a plain JSON object' },
    ]);
  });

  it('reports duplicate feature ids', () => {
    expect(loadIssues(rawData([box('a', 1), box('a', 2)]))).toEqual([
      { path: 'studio.features[1].id', message: "Duplicate feature id 'a'" },
    ]);
  });

  it.each([-1, 3, 1.5, '1', null])('reports rollbackIndex %s out of range', (rollbackIndex) => {
    expect(
      loadIssues(rawData([box('a', 1), box('b', 2)], rollbackIndex as number)).map((i) => i.path),
    ).toEqual(['studio.rollbackIndex']);
  });

  it('reports a missing studio or features array', () => {
    const meta = { id: 'd1', name: 'Doc', createdAt: 0 };
    expect(loadIssues({ meta }).map((i) => i.path)).toEqual(['studio']);
    expect(loadIssues({ meta, studio: { rollbackIndex: 0 } }).map((i) => i.path)).toEqual([
      'studio.features',
    ]);
  });
});
