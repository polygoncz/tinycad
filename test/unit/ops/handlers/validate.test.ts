import { describe, expect, it } from 'vitest';
import { createFeatureSchemaRegistry } from '@/document';
import { createOpHandlerRegistry } from '@/ops/handler';

const handlers = createOpHandlerRegistry({ schemas: createFeatureSchemaRegistry() });

const feature = {
  id: 'f1',
  type: 'box',
  typeVersion: 1,
  name: 'Box 1',
  suppressed: false,
  params: { size: 1 },
};

/** One valid operation of every built-in type, as raw data from outside. */
const valid: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  'feature.add': { type: 'feature.add', v: 1, feature, index: 0 },
  'feature.remove': { type: 'feature.remove', v: 1, featureId: 'f1' },
  'feature.setParams': {
    type: 'feature.setParams',
    v: 2,
    featureId: 'f1',
    typeVersion: 1,
    params: { size: 2 },
  },
  'feature.rename': { type: 'feature.rename', v: 1, featureId: 'f1', name: '' },
  'feature.suppress': { type: 'feature.suppress', v: 1, featureId: 'f1', suppressed: true },
  'feature.move': { type: 'feature.move', v: 1, featureId: 'f1', toIndex: 0 },
  'studio.setRollback': { type: 'studio.setRollback', v: 1, index: 0 },
  'body.rename': { type: 'body.rename', v: 1, body: 'f1/body', name: '' },
  'body.setVisible': { type: 'body.setVisible', v: 1, body: 'f1/body:2', visible: false },
  'body.setColor': { type: 'body.setColor', v: 1, body: 'f1/body', color: '#ff8800' },
  'body.setMaterial': { type: 'body.setMaterial', v: 1, body: 'f1/body', material: 'steel' },
};

const withFeature = (patch: Readonly<Record<string, unknown>>) => ({
  ...valid['feature.add'],
  feature: { ...feature, ...patch },
});

const without = (raw: Readonly<Record<string, unknown>>, key: string) =>
  Object.fromEntries(Object.entries(raw).filter(([k]) => k !== key));

// [type, broken raw operation, expected path]
const broken: readonly (readonly [string, Readonly<Record<string, unknown>>, string])[] = [
  ['feature.add', without(valid['feature.add'] ?? {}, 'feature'), 'feature'],
  ['feature.add', { ...valid['feature.add'], feature: null }, 'feature'],
  ['feature.add', { ...valid['feature.add'], feature: [] }, 'feature'],
  ['feature.add', withFeature({ id: '' }), 'feature.id'],
  ['feature.add', withFeature({ id: 3 }), 'feature.id'],
  ['feature.add', withFeature({ id: 'a/b' }), 'feature.id'],
  // The reserved owner of the origin planes (M12).
  ['feature.add', withFeature({ id: 'origin' }), 'feature.id'],
  ['feature.add', withFeature({ type: '' }), 'feature.type'],
  ['feature.add', withFeature({ type: undefined }), 'feature.type'],
  ['feature.add', withFeature({ typeVersion: 0 }), 'feature.typeVersion'],
  ['feature.add', withFeature({ typeVersion: 1.5 }), 'feature.typeVersion'],
  ['feature.add', withFeature({ name: 1 }), 'feature.name'],
  ['feature.add', withFeature({ suppressed: 'no' }), 'feature.suppressed'],
  ['feature.add', withFeature({ params: null }), 'feature.params'],
  ['feature.add', withFeature({ params: [] }), 'feature.params'],
  ['feature.add', withFeature({ params: 'x' }), 'feature.params'],
  // Params must be plain JSON, as fromData demands (M19.1): IndexedDB keeps NaN or a Date.
  ['feature.add', withFeature({ params: { size: Number.NaN } }), 'feature.params'],
  ['feature.add', withFeature({ params: { at: new Date(0) } }), 'feature.params'],
  ['feature.add', { ...valid['feature.add'], index: -1 }, 'index'],
  ['feature.add', { ...valid['feature.add'], index: 0.5 }, 'index'],
  ['feature.add', without(valid['feature.add'] ?? {}, 'index'), 'index'],
  ['feature.remove', { ...valid['feature.remove'], featureId: '' }, 'featureId'],
  ['feature.remove', without(valid['feature.remove'] ?? {}, 'featureId'), 'featureId'],
  ['feature.setParams', { ...valid['feature.setParams'], featureId: 1 }, 'featureId'],
  ['feature.setParams', without(valid['feature.setParams'] ?? {}, 'typeVersion'), 'typeVersion'],
  ['feature.setParams', { ...valid['feature.setParams'], typeVersion: 0 }, 'typeVersion'],
  ['feature.setParams', { ...valid['feature.setParams'], typeVersion: 1.5 }, 'typeVersion'],
  ['feature.setParams', { ...valid['feature.setParams'], typeVersion: '1' }, 'typeVersion'],
  ['feature.setParams', { ...valid['feature.setParams'], params: null }, 'params'],
  ['feature.setParams', { ...valid['feature.setParams'], params: [1] }, 'params'],
  ['feature.setParams', without(valid['feature.setParams'] ?? {}, 'params'), 'params'],
  ['feature.setParams', { ...valid['feature.setParams'], params: { size: undefined } }, 'params'],
  [
    'feature.setParams',
    { ...valid['feature.setParams'], params: { list: [Number.POSITIVE_INFINITY] } },
    'params',
  ],
  ['feature.rename', { ...valid['feature.rename'], featureId: '' }, 'featureId'],
  ['feature.rename', { ...valid['feature.rename'], name: null }, 'name'],
  ['feature.suppress', { ...valid['feature.suppress'], featureId: '' }, 'featureId'],
  ['feature.suppress', { ...valid['feature.suppress'], suppressed: 1 }, 'suppressed'],
  ['feature.move', { ...valid['feature.move'], featureId: '' }, 'featureId'],
  ['feature.move', { ...valid['feature.move'], toIndex: -1 }, 'toIndex'],
  ['feature.move', { ...valid['feature.move'], toIndex: '1' }, 'toIndex'],
  ['studio.setRollback', { ...valid['studio.setRollback'], index: -1 }, 'index'],
  ['studio.setRollback', { ...valid['studio.setRollback'], index: 1.5 }, 'index'],
  ['studio.setRollback', without(valid['studio.setRollback'] ?? {}, 'index'), 'index'],
  ['body.rename', without(valid['body.rename'] ?? {}, 'body'), 'body'],
  ['body.rename', { ...valid['body.rename'], body: '' }, 'body'],
  ['body.rename', { ...valid['body.rename'], body: 'f1' }, 'body'],
  ['body.rename', { ...valid['body.rename'], body: 'f1/body:0' }, 'body'],
  ['body.rename', { ...valid['body.rename'], body: 'f1/sketch' }, 'body'],
  ['body.rename', { ...valid['body.rename'], body: 7 }, 'body'],
  ['body.rename', { ...valid['body.rename'], name: null }, 'name'],
  ['body.rename', without(valid['body.rename'] ?? {}, 'name'), 'name'],
  ['body.setVisible', { ...valid['body.setVisible'], body: 'a/b/body' }, 'body'],
  ['body.setVisible', without(valid['body.setVisible'] ?? {}, 'body'), 'body'],
  ['body.setVisible', { ...valid['body.setVisible'], visible: 'no' }, 'visible'],
  ['body.setVisible', without(valid['body.setVisible'] ?? {}, 'visible'), 'visible'],
  ['body.setColor', { ...valid['body.setColor'], body: 'f1' }, 'body'],
  ['body.setColor', without(valid['body.setColor'] ?? {}, 'body'), 'body'],
  ['body.setColor', without(valid['body.setColor'] ?? {}, 'color'), 'color'],
  // Upper case is refused: the handler does not canonicalize, so replay stays deterministic.
  ['body.setColor', { ...valid['body.setColor'], color: '#FF8800' }, 'color'],
  ['body.setColor', { ...valid['body.setColor'], color: '#fff' }, 'color'],
  ['body.setColor', { ...valid['body.setColor'], color: 'red' }, 'color'],
  ['body.setColor', { ...valid['body.setColor'], color: 0xff8800 }, 'color'],
  ['body.setColor', { ...valid['body.setColor'], color: '' }, 'color'],
  ['body.setMaterial', { ...valid['body.setMaterial'], body: 'f1' }, 'body'],
  ['body.setMaterial', without(valid['body.setMaterial'] ?? {}, 'body'), 'body'],
  ['body.setMaterial', without(valid['body.setMaterial'] ?? {}, 'material'), 'material'],
  // The default is 'plastic', never null (M24).
  ['body.setMaterial', { ...valid['body.setMaterial'], material: null }, 'material'],
  ['body.setMaterial', { ...valid['body.setMaterial'], material: 'Steel' }, 'material'],
  ['body.setMaterial', { ...valid['body.setMaterial'], material: 'gold' }, 'material'],
  ['body.setMaterial', { ...valid['body.setMaterial'], material: '' }, 'material'],
  ['body.setMaterial', { ...valid['body.setMaterial'], material: 1 }, 'material'],
];

describe('validate of built-in handlers', () => {
  it('every built-in handler has validate', () => {
    expect(handlers.all().filter((h) => h.validate === undefined)).toEqual([]);
  });

  it.each(Object.entries(valid))('%s: a valid operation passes', (type, raw) => {
    expect(handlers.get(type).validate?.(raw)).toEqual([]);
  });

  it('body.setColor: null (the default color) passes', () => {
    const raw = { type: 'body.setColor', v: 1, body: 'f1/body:2', color: null };
    expect(handlers.get('body.setColor').validate?.(raw)).toEqual([]);
  });

  it('body.setMaterial: the default material plastic passes (M24)', () => {
    const raw = { type: 'body.setMaterial', v: 1, body: 'f1/body:2', material: 'plastic' };
    expect(handlers.get('body.setMaterial').validate?.(raw)).toEqual([]);
  });

  it.each(broken)('%s: %j fails at %j', (type, raw, path) => {
    const errors = handlers.get(type).validate?.(raw) ?? [];
    expect(errors.map((e) => e.path)).toContain(path);
  });
});
