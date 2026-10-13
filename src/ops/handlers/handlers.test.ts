import { describe, expect, it } from 'vitest';
import type { DocumentWriter, FeatureId } from '@/document';
import { toData } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { createOpHandlerRegistry } from '../handler';
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

const handlers = createOpHandlerRegistry();
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
    op: { type: 'feature.setParams', v: 1, featureId: id('b'), params: { size: 99 } },
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

      it('has version 1 and an inverse with the handler version', () => {
        expect(handler.version).toBe(1);
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
      { type: 'feature.setParams', v: 1, featureId: missing, params: {} },
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
    const op = (featureId: string, size: number): Op => ({
      type: 'feature.setParams',
      v: 1,
      featureId: id(featureId),
      params: { size },
    });

    it('same feature gives next', () => {
      const next = op('a', 2);
      expect(handler.merge?.(op('a', 1), next)).toBe(next);
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
