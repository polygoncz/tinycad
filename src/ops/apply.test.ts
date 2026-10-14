import { describe, expect, it } from 'vitest';
import type { DocumentWriter, FeatureId } from '@/document';
import { createFeatureSchemaRegistry, toData } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { applyOperation } from './apply';
import { createOperationDispatcher } from './dispatcher';
import { createOpHandlerRegistry } from './handler';
import { createOperationLog } from './log';
import type { LogEntry } from './log';
import type {
  BatchOp,
  BodySetColorOp,
  FeatureAddOp,
  FeatureMoveOp,
  FeatureRemoveOp,
  FeatureRenameOp,
  FeatureSetParamsOp,
  FeatureSuppressOp,
  Operation,
  StudioSetRollbackOp,
} from './operation';
import { replayLog } from './replay';
import { anOpsSession } from './testing';
import { createUndoManager } from './undo';

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
const handlers = createOpHandlerRegistry({ schemas: createFeatureSchemaRegistry() });

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
        {
          type: 'feature.setParams',
          v: 2,
          featureId: id('b'),
          typeVersion: 1,
          params: { size: 7 },
        },
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
    const reg = createOpHandlerRegistry({ schemas: createFeatureSchemaRegistry() });
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

describe('applyOperation – validation on write (D1)', () => {
  const setParams = (params: unknown): FeatureSetParamsOp => ({
    type: 'feature.setParams',
    v: 2,
    featureId: id('b'),
    typeVersion: 1,
    params,
  });

  /** Runs `act`, expects it to throw and the document to stay as it was, without events. */
  function expectRejected(doc: DocumentWriter, act: () => unknown, message: RegExp): void {
    const studio = doc.studio;
    const before = toData(doc);
    let changes = 0;
    const off = doc.events.on('changed', () => {
      changes++;
    });
    expect(act).toThrow(message);
    off();
    expect(doc.studio).toBe(studio);
    expect(toData(doc)).toEqual(before);
    expect(changes).toBe(0);
  }

  it.each([
    ['NaN', { size: Number.NaN }],
    ['Infinity', { size: Number.POSITIVE_INFINITY }],
    ['-Infinity', { size: Number.NEGATIVE_INFINITY }],
    ['undefined', { size: 1, extra: undefined }],
    ['NaN deep inside', { list: [{ x: Number.NaN }] }],
    ['a Date', { at: new Date(0) }],
  ])('feature.setParams with %s in params throws and changes nothing', (_, params) => {
    const doc = setup(3);
    expectRejected(doc, () => applyOperation(doc, handlers, setParams(params)), /params/);
  });

  it('feature.add with params that are not plain JSON throws and changes nothing', () => {
    const doc = setup(3);
    const op: FeatureAddOp = {
      type: 'feature.add',
      v: 1,
      feature: aFeature({ id: 'n', params: { size: Number.NaN } }),
      index: 0,
    };
    expectRejected(doc, () => applyOperation(doc, handlers, op), /feature\.params/);
  });

  it("feature.add with the id 'a/b' throws: the file could not be read back", () => {
    const doc = setup(3);
    const op: FeatureAddOp = {
      type: 'feature.add',
      v: 1,
      feature: aFeature({ id: 'a/b' }),
      index: 0,
    };
    expectRejected(doc, () => applyOperation(doc, handlers, op), /feature\.id/);
  });

  it("body.setColor with '#FF0000' throws: only lower case passes loading", () => {
    const doc = setup(3);
    const op: BodySetColorOp = {
      type: 'body.setColor',
      v: 1,
      body: 'a/body' as BodySetColorOp['body'],
      color: '#FF0000',
    };
    expectRejected(doc, () => applyOperation(doc, handlers, op), /color/);
  });

  it('lists every problem of the operation in the error', () => {
    const doc = setup(3);
    const op: FeatureAddOp = {
      type: 'feature.add',
      v: 1,
      feature: aFeature({ id: 'a/b', params: { size: Number.NaN } }),
      index: 0,
    };
    expect(() => applyOperation(doc, handlers, op)).toThrow(/feature\.id.*feature\.params/s);
  });

  it('validates before invert: bad params of a missing feature report the params', () => {
    const doc = setup(3);
    const op: FeatureSetParamsOp = { ...setParams({ size: Number.NaN }), featureId: id('zzz') };
    expect(() => applyOperation(doc, handlers, op)).toThrow(/params/);
  });

  it('a bad sub-operation reverts the batch', () => {
    const doc = setup(3);
    const before = toData(doc);
    expect(() =>
      applyOperation(doc, handlers, batch(rename('a', 'A1'), setParams({ size: Number.NaN }))),
    ).toThrow(/params/);
    // The rename was applied and reverted: equal data, not the same object.
    expect(toData(doc)).toEqual(before);
  });

  it('dispatch of a bad operation throws and appends nothing', () => {
    const { doc, log, dispatcher } = anOpsSession({ features: [aFeature({ id: 'b' })] });
    expectRejected(doc, () => dispatcher.dispatch(setParams({ size: Number.NaN })), /params/);
    expect(log.lastSeq).toBe(0);
  });

  it('a transaction refuses a bad operation and stays open and unchanged', () => {
    const { doc, log, dispatcher } = anOpsSession({ features: [aFeature({ id: 'b' })] });
    const tx = dispatcher.begin('Edit');
    expectRejected(
      doc,
      () => {
        tx.apply(setParams({ size: undefined }));
      },
      /params/,
    );
    expectRejected(
      doc,
      () => {
        tx.applyTransient(setParams({ size: Number.NaN }));
      },
      /params/,
    );
    expect(dispatcher.inTransaction).toBe(true);
    expect(tx.commit()).toBeNull();
    expect(log.lastSeq).toBe(0);
  });

  it('undo of an entry whose inverse is not plain JSON throws and appends nothing', () => {
    const doc = aDocument({ features: [aFeature({ id: 'b', name: 'B' })] });
    const entry: LogEntry = {
      seq: 1,
      kind: 'do',
      op: rename('b', 'B'),
      inverse: setParams({ size: Number.NaN }),
      label: 'Broken',
      time: 0,
    };
    const log = createOperationLog([entry]);
    const dispatcher = createOperationDispatcher({ doc, handlers, log });
    const undo = createUndoManager({ dispatcher, log });
    expectRejected(
      doc,
      () => {
        undo.undo();
      },
      /params/,
    );
    expect(log.lastSeq).toBe(1);
    expect(undo.stacks()).toEqual({ undo: [1], redo: [] });
  });

  it('replaying a log entry with a bad operation throws', () => {
    const doc = aDocument({ features: [aFeature({ id: 'b' })] });
    const entry: LogEntry = {
      seq: 1,
      kind: 'do',
      op: setParams({ size: Number.POSITIVE_INFINITY }),
      inverse: setParams({ size: 1 }),
      label: 'Broken',
      time: 0,
    };
    expectRejected(
      doc,
      () => {
        replayLog(doc, handlers, [entry]);
      },
      /params/,
    );
  });

  it.each([
    ['a newer', 3],
    // Upcast belongs to loading only: a write is always in the current version.
    ['an older', 1],
  ])('feature.setParams in %s version throws and changes nothing', (_, v) => {
    const doc = setup(3);
    const op: FeatureSetParamsOp = { ...setParams({ size: 7 }), v };
    expectRejected(
      doc,
      () => applyOperation(doc, handlers, op),
      new RegExp(`feature\\.setParams.*${String(v)}.*2`),
    );
  });

  it('a batch with another version throws and applies none of its operations', () => {
    const doc = setup(3);
    const op: BatchOp = { type: 'batch', v: 2, ops: [rename('a', 'A1')] };
    expectRejected(doc, () => applyOperation(doc, handlers, op), /batch.*2.*1/);
  });

  it('a sub-operation with another version reverts the batch', () => {
    const doc = setup(3);
    const before = toData(doc);
    const stale: FeatureRenameOp = { type: 'feature.rename', v: 2, featureId: id('b'), name: 'X' };
    expect(() => applyOperation(doc, handlers, batch(rename('a', 'A1'), stale))).toThrow(
      /feature\.rename.*2.*1/,
    );
    expect(toData(doc)).toEqual(before);
  });

  it('a valid operation still passes', () => {
    const doc = setup(3);
    applyOperation(doc, handlers, setParams({ size: 7, list: [1, { x: -0 }], ref: null }));
    expect(doc.feature(id('b'))?.params).toEqual({ size: 7, list: [1, { x: -0 }], ref: null });
  });
});
