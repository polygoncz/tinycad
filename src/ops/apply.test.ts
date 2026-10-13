import { describe, expect, it } from 'vitest';
import type { DocumentWriter, FeatureId } from '@/document';
import { toData } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { applyOperation } from './apply';
import { createOpHandlerRegistry } from './handler';
import type {
  BatchOp,
  FeatureAddOp,
  FeatureMoveOp,
  FeatureRemoveOp,
  FeatureRenameOp,
  FeatureSetParamsOp,
  FeatureSuppressOp,
  Operation,
  StudioSetRollbackOp,
} from './operation';

// Union of concrete ops keeps excess-property checks on the literals.
type Op =
  | FeatureAddOp
  | FeatureRemoveOp
  | FeatureSetParamsOp
  | FeatureRenameOp
  | FeatureSuppressOp
  | FeatureMoveOp
  | StudioSetRollbackOp
  | BatchOp;

const id = (s: string): FeatureId => s as FeatureId;
const handlers = createOpHandlerRegistry();

function setup(rollbackIndex: number): DocumentWriter {
  return aDocument({
    features: [
      aFeature({ id: 'a', name: 'A' }),
      aFeature({ id: 'b', name: 'B' }),
      aFeature({ id: 'c', name: 'C' }),
    ],
    rollbackIndex,
  });
}

const rename = (featureId: string, name: string): Op => ({
  type: 'feature.rename',
  v: 1,
  featureId: id(featureId),
  name,
});
const batch = (...ops: Operation[]): BatchOp => ({ type: 'batch', v: 1, ops });
const names = (doc: DocumentWriter): string[] => doc.studio.features.map((f) => f.name);

describe('applyOperation – rollback bar', () => {
  const ops: Record<string, (i: number) => Op> = {
    add: (i) => ({ type: 'feature.add', v: 1, feature: aFeature({ id: 'n' }), index: i }),
    remove: (i) => ({ type: 'feature.remove', v: 1, featureId: id('abc'[i] ?? 'a') }),
    move: (i) => ({ type: 'feature.move', v: 1, featureId: id('a'), toIndex: i }),
  };

  for (const [name, make] of Object.entries(ops)) {
    for (let bar = 0; bar <= 3; bar++) {
      for (let at = 0; at <= (name === 'add' ? 3 : 2); at++) {
        it(`${name}(${String(at)}) with bar at ${String(bar)}: inverse restores toData`, () => {
          const doc = setup(bar);
          const before = toData(doc);
          const { inverse } = applyOperation(doc, handlers, make(at));
          applyOperation(doc, handlers, inverse);
          expect(toData(doc)).toEqual(before);
        });
      }
    }
  }

  it('wraps the inverse in a batch with setRollback when the bar moved', () => {
    const doc = setup(3);
    const op = ops['add']?.(0);
    if (!op) throw new Error('missing');
    const { inverse } = applyOperation(doc, handlers, op);
    expect(inverse.type).toBe('batch');
    expect((inverse as BatchOp).ops[1]).toEqual({ type: 'studio.setRollback', v: 1, index: 3 });
  });

  it('does not wrap rename, setParams and suppress', () => {
    for (const bar of [0, 1, 3]) {
      const doc = setup(bar);
      const plain: Op[] = [
        rename('b', 'X'),
        { type: 'feature.setParams', v: 1, featureId: id('b'), params: { size: 7 } },
        { type: 'feature.suppress', v: 1, featureId: id('b'), suppressed: true },
      ];
      for (const op of plain) {
        expect(applyOperation(doc, handlers, op).inverse.type).not.toBe('batch');
      }
    }
  });

  it('wraps add, remove and move at every bar position', () => {
    for (const bar of [0, 1, 2, 3]) {
      for (const [name, make] of Object.entries(ops)) {
        const at = name === 'move' ? 2 : 0;
        const { inverse } = applyOperation(setup(bar), handlers, make(at));
        expect(inverse.type, `${name} bar ${String(bar)}`).toBe('batch');
      }
    }
  });

  it('does not wrap studio.setRollback', () => {
    const setRollback: StudioSetRollbackOp = { type: 'studio.setRollback', v: 1, index: 1 };
    const doc = setup(3);
    const { inverse } = applyOperation(doc, handlers, setRollback);
    expect(inverse).toEqual({ type: 'studio.setRollback', v: 1, index: 3 });
  });
});

describe('applyOperation – batch', () => {
  it('inverts sub-operations in reverse order', () => {
    const doc = setup(3);
    const before = toData(doc);
    const { inverse } = applyOperation(doc, handlers, batch(rename('a', 'A1'), rename('a', 'A2')));
    expect(names(doc)).toEqual(['A2', 'B', 'C']);
    expect(inverse).toEqual(batch(rename('a', 'A1'), rename('a', 'A')));
    applyOperation(doc, handlers, inverse);
    expect(toData(doc)).toEqual(before);
  });

  it('handles nested batches', () => {
    const doc = setup(3);
    const before = toData(doc);
    const { inverse } = applyOperation(
      doc,
      handlers,
      batch(rename('a', 'A1'), batch(rename('b', 'B1'), rename('c', 'C1'))),
    );
    expect(names(doc)).toEqual(['A1', 'B1', 'C1']);
    applyOperation(doc, handlers, inverse);
    expect(toData(doc)).toEqual(before);
  });

  it('empty batch changes nothing and inverts to an empty batch', () => {
    const doc = setup(3);
    const before = toData(doc);
    const { inverse, deferred } = applyOperation(doc, handlers, batch());
    expect(toData(doc)).toEqual(before);
    expect(inverse).toEqual(batch());
    expect(deferred).toEqual([]);
  });

  it('is atomic: a failing 2nd sub-operation reverts the 1st and throws the original', () => {
    const doc = setup(3);
    const before = toData(doc);
    expect(() =>
      applyOperation(doc, handlers, batch(rename('a', 'A1'), rename('zzz', 'x'))),
    ).toThrow(/zzz|exist|not/i);
    expect(toData(doc)).toEqual(before);
  });

  it('rethrows the very same error object when reverting succeeds', () => {
    const failure = new Error('boom');
    const reg = createOpHandlerRegistry();
    reg.register({
      type: 'test.fail',
      version: 1,
      invert: () => ({ type: 'test.fail', v: 1 }),
      apply: () => {
        throw failure;
      },
    });
    const doc = setup(3);
    const failOp: Operation = { type: 'test.fail', v: 1 };
    let caught: unknown;
    try {
      applyOperation(doc, reg, batch(rename('a', 'A1'), failOp));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(failure);
    expect(names(doc)).toEqual(['A', 'B', 'C']);
  });

  it('batch needs no handler in the registry', () => {
    expect(handlers.has('batch')).toBe(false);
    expect(() => applyOperation(setup(0), handlers, batch())).not.toThrow();
  });
});

describe('applyOperation – subscriber exceptions', () => {
  it('handler failure (document unchanged) throws at once', () => {
    const doc = setup(3);
    const err = new Error('subscriber');
    doc.events.on('changed', () => {
      throw err;
    });
    expect(() => applyOperation(doc, handlers, rename('zzz', 'x'))).toThrow();
    expect(() => applyOperation(doc, handlers, rename('zzz', 'x'))).not.toThrow(err);
  });

  it('invert failure throws at once even with a throwing subscriber', () => {
    const doc = setup(3);
    doc.events.on('changed', () => {
      throw new Error('subscriber');
    });
    expect(() => applyOperation(doc, handlers, rename('zzz', 'x'))).toThrow(/zzz|exist|not/i);
  });

  it('subscriber throwing after the change is deferred and the inverse is computed', () => {
    const doc = setup(3);
    const err = new Error('subscriber');
    doc.events.on('changed', () => {
      throw err;
    });
    const { inverse, deferred } = applyOperation(doc, handlers, rename('a', 'A1'));
    expect(names(doc)).toEqual(['A1', 'B', 'C']);
    expect(inverse).toEqual(rename('a', 'A'));
    expect(deferred).toEqual([err]);
  });

  it('a batch continues after a deferred exception and collects all of them', () => {
    const doc = setup(3);
    doc.events.on('changed', () => {
      throw new Error('subscriber');
    });
    const { deferred } = applyOperation(doc, handlers, batch(rename('a', 'A1'), rename('b', 'B1')));
    expect(names(doc)).toEqual(['A1', 'B1', 'C']);
    expect(deferred).toHaveLength(2);
  });

  it('failure after deferred exceptions: AggregateError with the original first', () => {
    const doc = setup(3);
    const sub = new Error('subscriber');
    const off = doc.events.on('changed', () => {
      throw sub;
    });
    let caught: unknown;
    try {
      applyOperation(doc, handlers, batch(rename('a', 'A1'), rename('zzz', 'x')));
    } catch (e) {
      caught = e;
    }
    off();
    expect(caught).toBeInstanceOf(AggregateError);
    const errors = (caught as AggregateError).errors as unknown[];
    expect(errors[0]).not.toBe(sub);
    // earlier deferred, then the one thrown while reverting
    expect(errors.slice(1)).toEqual([sub, sub]);
    expect(names(doc)).toEqual(['A', 'B', 'C']);
  });
});
