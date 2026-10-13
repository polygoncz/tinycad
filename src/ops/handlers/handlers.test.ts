import { describe, expect, it } from 'vitest';
import type { DocumentWriter, FeatureId, FeatureSchema } from '@/document';
import { createFeatureSchemaRegistry, toData } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { createOpHandlerRegistry } from '../handler';
import { OP_VERSION } from '../operation';
import type {
  FeatureAddOp,
  FeatureMoveOp,
  FeatureRemoveOp,
  FeatureRenameOp,
  FeatureSetParamsOp,
  FeatureSuppressOp,
  StudioSetRollbackOp,
} from '../operation';

// A union of concrete operations keeps excess-property checks on the literals.
type Op =
  | FeatureAddOp
  | FeatureRemoveOp
  | FeatureSetParamsOp
  | FeatureRenameOp
  | FeatureSuppressOp
  | FeatureMoveOp
  | StudioSetRollbackOp;

// No schemas: the 'box' features of aFeature() have an unknown type, nothing is migrated.
const handlers = createOpHandlerRegistry({ schemas: createFeatureSchemaRegistry() });
const id = (s: string): FeatureId => s as FeatureId;

function setup(rollbackIndex?: number): DocumentWriter {
  return aDocument({
    features: [
      aFeature({ id: 'a', name: 'A', params: { size: 1 } }),
      aFeature({ id: 'b', name: 'B', params: { size: 2 } }),
      aFeature({ id: 'c', name: 'C', params: { size: 3 } }),
    ],
    ...(rollbackIndex === undefined ? {} : { rollbackIndex }),
  });
}

interface Case {
  readonly name: string;
  readonly op: Op;
  /** Structural ops move the rollback bar, which handlers do not restore (done by applyOp). */
  readonly compare: 'toData' | 'features';
}

const removeB: Op = { type: 'feature.remove', v: 1, featureId: id('b') };
const moveA: Op = { type: 'feature.move', v: 1, featureId: id('a'), toIndex: 2 };

const cases: readonly Case[] = [
  {
    name: 'feature.add',
    op: { type: 'feature.add', v: 1, feature: aFeature({ id: 'n' }), index: 1 },
    compare: 'features',
  },
  { name: 'feature.remove', op: removeB, compare: 'features' },
  {
    name: 'feature.setParams',
    op: {
      type: 'feature.setParams',
      v: 2,
      featureId: id('b'),
      typeVersion: 1,
      params: { size: 99 },
    },
    compare: 'toData',
  },
  {
    name: 'feature.rename',
    op: { type: 'feature.rename', v: 1, featureId: id('b'), name: 'New' },
    compare: 'toData',
  },
  {
    name: 'feature.suppress',
    op: { type: 'feature.suppress', v: 1, featureId: id('b'), suppressed: true },
    compare: 'toData',
  },
  {
    name: 'feature.move',
    op: moveA,
    compare: 'features',
  },
  {
    name: 'studio.setRollback',
    op: { type: 'studio.setRollback', v: 1, index: 1 },
    compare: 'toData',
  },
];

describe('built-in op handlers', () => {
  for (const { name, op, compare } of cases) {
    describe(name, () => {
      const handler = handlers.get(op.type);

      it('has its OP_VERSION and an inverse with the handler version', () => {
        expect(handler.version).toBe(OP_VERSION[op.type]);
        expect(handler.invert(setup(), op).v).toBe(handler.version);
      });

      it('invert does not change the document', () => {
        const doc = setup();
        const before = toData(doc);
        handler.invert(doc, op);
        expect(toData(doc)).toEqual(before);
      });

      it('apply then apply(inverse) restores the original', () => {
        const doc = setup();
        const before = toData(doc);
        const inverse = handler.invert(doc, op);
        handler.apply(doc, op);
        expect(toData(doc)).not.toEqual(before);
        handlers.get(inverse.type).apply(doc, inverse);
        if (compare === 'toData') expect(toData(doc)).toEqual(before);
        else expect(toData(doc).studio.features).toEqual(before.studio.features);
      });
    });
  }

  it('feature.remove inverse carries the instance and its index', () => {
    const doc = setup();
    const inverse = handlers.get('feature.remove').invert(doc, removeB);
    expect(inverse).toEqual({ type: 'feature.add', v: 1, feature: doc.feature(id('b')), index: 1 });
  });

  it('feature.move inverse targets the current index', () => {
    const inverse = handlers.get('feature.move').invert(setup(), moveA);
    expect(inverse).toEqual({ type: 'feature.move', v: 1, featureId: id('a'), toIndex: 0 });
  });

  it('invert on a missing feature throws and leaves the document alone', () => {
    const missing = id('zzz');
    const ops: readonly Op[] = [
      { type: 'feature.remove', v: 1, featureId: missing },
      { type: 'feature.setParams', v: 2, featureId: missing, typeVersion: 1, params: {} },
      { type: 'feature.rename', v: 1, featureId: missing, name: 'x' },
      { type: 'feature.suppress', v: 1, featureId: missing, suppressed: true },
      { type: 'feature.move', v: 1, featureId: missing, toIndex: 0 },
    ];
    for (const op of ops) {
      const doc = setup();
      const before = toData(doc);
      expect(() => handlers.get(op.type).invert(doc, op)).toThrow();
      expect(toData(doc)).toEqual(before);
    }
  });

  describe('merge', () => {
    const handler = handlers.get('feature.setParams');
    const op = (featureId: string, size: number, typeVersion = 1): Op => ({
      type: 'feature.setParams',
      v: 2,
      featureId: id(featureId),
      typeVersion,
      params: { size },
    });

    it('same feature gives next', () => {
      const next = op('a', 2);
      expect(handler.merge?.(op('a', 1), next)).toBe(next);
    });

    it('same feature gives next with its own typeVersion', () => {
      const next = op('a', 2, 2);
      expect(handler.merge?.(op('a', 1, 1), next)).toEqual(next);
    });

    it('different feature gives null', () => {
      expect(handler.merge?.(op('a', 1), op('b', 2))).toBeNull();
    });

    it('only setParams has merge', () => {
      const withMerge = handlers.all().filter((h) => h.merge !== undefined);
      expect(withMerge.map((h) => h.type)).toEqual(['feature.setParams']);
    });
  });
});

describe('feature.setParams and typeVersion', () => {
  const setParams = (typeVersion: number, params: unknown): Op => ({
    type: 'feature.setParams',
    v: 2,
    featureId: id('b'),
    typeVersion,
    params,
  });

  it('apply sets the typeVersion of the operation on the feature', () => {
    const doc = setup();
    handlers.get('feature.setParams').apply(doc, setParams(3, { size: 7 }));
    expect(doc.feature(id('b'))).toMatchObject({ typeVersion: 3, params: { size: 7 } });
  });

  it('invert carries the current typeVersion and params of the feature', () => {
    const doc = setup();
    expect(handlers.get('feature.setParams').invert(doc, setParams(3, { size: 7 }))).toEqual({
      type: 'feature.setParams',
      v: 2,
      featureId: id('b'),
      typeVersion: 1,
      params: { size: 2 },
    });
  });

  it('apply then apply(inverse) restores the typeVersion too', () => {
    const doc = setup();
    const before = toData(doc);
    const handler = handlers.get('feature.setParams');
    const inverse = handler.invert(doc, setParams(3, { size: 7 }));
    handler.apply(doc, setParams(3, { size: 7 }));
    handler.apply(doc, inverse);
    expect(toData(doc)).toEqual(before);
  });
});

describe('migration of feature data when applied (Q035)', () => {
  interface BoxV2 {
    readonly width: number;
  }
  // Box v2 renamed `w` to `width`: log entries written with version 1 carry `w`.
  const boxV2: FeatureSchema<BoxV2> = {
    type: 'box',
    version: 2,
    label: 'box.label',
    params: { width: { kind: 'length', label: 'box.width', default: 1 } },
    defaults: () => ({ width: 1 }),
    validate: () => [],
    migrate(fromVersion, raw) {
      if (fromVersion !== 1) throw new Error(`Unsupported version ${String(fromVersion)}`);
      const { w } = raw as { w: unknown }; // version 1 params, checked right below
      if (typeof w !== 'number') throw new Error('w must be a number');
      return { width: w };
    },
  };
  const schemas = createFeatureSchemaRegistry();
  schemas.register(boxV2);
  const migrating = createOpHandlerRegistry({ schemas });

  const boxA = aFeature<BoxV2>({ id: 'a', typeVersion: 2, params: { width: 1 } });
  const teleport = aFeature({ id: 't', type: 'teleport', typeVersion: 7, params: { size: 1 } });
  const v2Doc = (): DocumentWriter => aDocument({ features: [boxA, teleport] });

  const setParams = (featureId: string, typeVersion: number, params: unknown): Op => ({
    type: 'feature.setParams',
    v: 2,
    featureId: id(featureId),
    typeVersion,
    params,
  });
  const add = (typeVersion: number, params: Readonly<Record<string, unknown>>): FeatureAddOp => ({
    type: 'feature.add',
    v: 1,
    feature: aFeature({ id: 'n', name: 'N', typeVersion, params }),
    index: 1,
  });

  /** apply through the migrating handlers, as applyOperation would call them. */
  function apply(doc: DocumentWriter, op: Op): void {
    migrating.get(op.type).apply(doc, op);
  }

  it('feature.add with a version 1 feature inserts it on version 2', () => {
    const doc = v2Doc();
    apply(doc, add(1, { w: 3 }));
    expect(doc.feature(id('n'))).toEqual({
      id: 'n',
      type: 'box',
      typeVersion: 2,
      name: 'N',
      params: { width: 3 },
      suppressed: false,
    });
  });

  it('feature.add with a current feature inserts the very instance', () => {
    const doc = v2Doc();
    const op = add(2, { width: 3 });
    apply(doc, op);
    expect(doc.feature(id('n'))).toBe(op.feature);
  });

  it('feature.setParams with typeVersion 1 sets version 2 params and typeVersion', () => {
    const doc = v2Doc();
    apply(doc, setParams('a', 1, { w: 5 }));
    expect(doc.feature(id('a'))).toEqual({ ...boxA, typeVersion: 2, params: { width: 5 } });
  });

  it('feature.setParams on a feature of an unknown type sets the data unchanged', () => {
    const doc = v2Doc();
    const params = { size: 9 };
    apply(doc, setParams('t', 7, params));
    expect(doc.feature(id('t'))).toEqual({ ...teleport, params });
    expect(doc.feature(id('t'))?.params).toBe(params);
  });

  it('apply then apply(inverse) of an old setParams restores the version 2 document', () => {
    const doc = v2Doc();
    const before = toData(doc);
    const op = setParams('a', 1, { w: 5 });
    const inverse = migrating.get(op.type).invert(doc, op);
    expect(inverse).toMatchObject({ typeVersion: 2, params: { width: 1 } });
    apply(doc, op);
    migrating.get(inverse.type).apply(doc, inverse);
    expect(toData(doc)).toEqual(before);
  });

  it.each([
    ['setParams whose migrate throws', setParams('a', 1, { w: 'x' }), /w must be a number/],
    ['setParams newer than the schema', setParams('a', 3, { width: 1 }), /newer/],
    ['add whose migrate throws', add(1, { w: 'x' }), /w must be a number/],
    ['add newer than the schema', add(3, { width: 1 }), /newer/],
  ])('a failing migration (%s) throws and leaves the document unchanged', (_, op, message) => {
    const doc = v2Doc();
    const before = toData(doc);
    expect(() => {
      apply(doc, op);
    }).toThrow(message);
    expect(toData(doc)).toEqual(before);
  });
});
