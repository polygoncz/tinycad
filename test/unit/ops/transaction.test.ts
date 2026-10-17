import { describe, expect, it } from 'vitest';
import type { FeatureId } from '@/document';
import { createFeatureSchemaRegistry } from '@/document';
import { aDocument, aFeature, toData } from '@/document/testing';
import { createOperationDispatcher } from '@/ops/dispatcher';
import { createOpHandlerRegistry } from '@/ops/handler';
import { createOperationLog } from '@/ops/log';
import type { LogEntry } from '@/ops/legacy-ports';
import type {
  FeatureAddOp,
  FeatureRemoveOp,
  FeatureSetParamsOp,
  Operation,
  StudioSetRollbackOp,
} from '@/ops/operation';

const id = (s: string): FeatureId => s as FeatureId;
const setParams = (featureId: string, size: number): FeatureSetParamsOp => ({
  type: 'feature.setParams',
  v: 2,
  featureId: id(featureId),
  typeVersion: 1,
  params: { size },
});

function setup() {
  const doc = aDocument({
    features: [
      aFeature({ id: 'a', name: 'A', params: { size: 0 } }),
      aFeature({ id: 'b', name: 'B', params: { size: 0 } }),
    ],
  });
  const handlers = createOpHandlerRegistry({ schemas: createFeatureSchemaRegistry() });
  const log = createOperationLog();
  const dispatcher = createOperationDispatcher({ doc, handlers, log });
  return { doc, handlers, log, dispatcher };
}

const setRollback = (index: number): StudioSetRollbackOp => ({
  type: 'studio.setRollback',
  v: 1,
  index,
});

describe('commit', () => {
  it('compresses 50 setParams of one feature into one entry', () => {
    const { log, dispatcher } = setup();
    const tx = dispatcher.begin('Drag');
    for (let i = 1; i <= 50; i++) tx.apply(setParams('a', i));
    const entry = tx.commit();
    expect(log.lastSeq).toBe(1);
    expect(entry).toMatchObject({
      kind: 'do',
      label: 'Drag',
      op: setParams('a', 50),
      inverse: setParams('a', 0),
    });
  });

  it('makes a batch of add and merged setParams', () => {
    const { log, dispatcher } = setup();
    const feature = aFeature({ id: 'c', params: { size: 1 } });
    const add: FeatureAddOp = { type: 'feature.add', v: 1, feature, index: 2 };
    const tx = dispatcher.begin('Box');
    tx.apply(add);
    for (let i = 2; i <= 6; i++) tx.apply(setParams('c', i));
    const entry = tx.commit();
    expect(log.lastSeq).toBe(1);
    expect(entry?.op).toEqual({ type: 'batch', v: 1, ops: [add, setParams('c', 6)] });
    expect(entry?.inverse).toMatchObject({ type: 'batch', v: 1 });
  });

  it('does not merge non-adjacent ops (A, B, A)', () => {
    const { dispatcher } = setup();
    const tx = dispatcher.begin('x');
    tx.apply(setParams('a', 1));
    tx.apply(setParams('b', 2));
    tx.apply(setParams('a', 3));
    const entry = tx.commit();
    expect(entry?.op).toEqual({
      type: 'batch',
      v: 1,
      ops: [setParams('a', 1), setParams('b', 2), setParams('a', 3)],
    });
    expect(entry?.inverse).toEqual({
      type: 'batch',
      v: 1,
      ops: [setParams('a', 1), setParams('b', 0), setParams('a', 0)],
    });
  });

  it('an empty transaction returns null and writes nothing', () => {
    const { log, dispatcher } = setup();
    const applied: unknown[] = [];
    dispatcher.events.on('applied', (e) => applied.push(e));
    expect(dispatcher.begin('x').commit()).toBeNull();
    expect(log.lastSeq).toBe(0);
    expect(applied).toEqual([]);
    expect(dispatcher.inTransaction).toBe(false);
  });

  it('emits applied with the entry and throws subscriber errors after writing', () => {
    const { log, dispatcher } = setup();
    const seen: (LogEntry | null)[] = [];
    dispatcher.events.on('applied', (e) => seen.push(e.entry));
    log.events.on('appended', () => {
      throw new Error('boom');
    });
    const tx = dispatcher.begin('x');
    tx.apply(setParams('a', 1));
    expect(() => tx.commit()).toThrow('boom');
    expect(log.lastSeq).toBe(1);
    expect(seen).toEqual([null, log.entries()[0]]);
    expect(dispatcher.inTransaction).toBe(false);
  });
});

describe('abort', () => {
  it('restores document and leaves the log untouched', () => {
    const { doc, log, dispatcher } = setup();
    const before = toData(doc);
    const applied: { entry: LogEntry | null; op: Operation }[] = [];
    const tx = dispatcher.begin('x');
    tx.apply(setParams('a', 1));
    const remove: FeatureRemoveOp = { type: 'feature.remove', v: 1, featureId: id('b') };
    tx.apply(remove);
    dispatcher.events.on('applied', (e) => applied.push(e));
    tx.abort();
    expect(toData(doc)).toEqual(before);
    expect(log.lastSeq).toBe(0);
    expect(applied.map((e) => e.entry)).toEqual([null, null]);
    expect(applied[1]?.op).toEqual(setParams('a', 0));
  });

  it('ends even when a subscriber throws', () => {
    const { doc, dispatcher } = setup();
    const before = toData(doc);
    const tx = dispatcher.begin('x');
    tx.apply(setParams('a', 1));
    dispatcher.events.on('applied', () => {
      throw new Error('boom');
    });
    expect(() => {
      tx.abort();
    }).toThrow('boom');
    expect(toData(doc)).toEqual(before);
    expect(dispatcher.inTransaction).toBe(false);
  });
});

describe('lifecycle', () => {
  it('a failing apply leaves the transaction open and unchanged', () => {
    const { doc, dispatcher } = setup();
    const tx = dispatcher.begin('x');
    tx.apply(setParams('a', 1));
    expect(() => {
      tx.apply(setParams('missing', 2));
    }).toThrow();
    expect(dispatcher.inTransaction).toBe(true);
    const entry = tx.commit();
    expect(entry?.op).toEqual(setParams('a', 1));
    expect(doc.studio.features[0]?.params).toEqual({ size: 1 });
  });

  it('a second begin throws', () => {
    const { dispatcher } = setup();
    dispatcher.begin('x');
    expect(() => dispatcher.begin('y')).toThrow();
  });

  it('every call after the end throws', () => {
    const { dispatcher } = setup();
    const tx = dispatcher.begin('x');
    tx.commit();
    expect(() => {
      tx.apply(setParams('a', 1));
    }).toThrow();
    expect(() => tx.commit()).toThrow();
    expect(() => {
      tx.abort();
    }).toThrow();
    const tx2 = dispatcher.begin('y');
    tx2.abort();
    expect(() => tx2.commit()).toThrow();
  });

  it('dispatch during a transaction throws', () => {
    const { log, dispatcher } = setup();
    const tx = dispatcher.begin('x');
    expect(() => dispatcher.dispatch(setParams('a', 1))).toThrow();
    tx.abort();
    dispatcher.dispatch(setParams('a', 1));
    expect(log.lastSeq).toBe(1);
  });

  it('emits transaction events', () => {
    const { dispatcher } = setup();
    const seen: boolean[] = [];
    dispatcher.events.on('transaction', (e) => seen.push(e.active));
    expect(dispatcher.inTransaction).toBe(false);
    const tx = dispatcher.begin('x');
    expect(dispatcher.inTransaction).toBe(true);
    tx.commit();
    dispatcher.begin('y').abort();
    expect(seen).toEqual([true, false, true, false]);
  });

  it('begin is atomic when a transaction subscriber throws', () => {
    const { log, dispatcher } = setup();
    const seen: boolean[] = [];
    const off = dispatcher.events.on('transaction', (e) => {
      seen.push(e.active);
      if (e.active) throw new Error('boom');
    });
    expect(() => dispatcher.begin('x')).toThrow('boom');
    off();
    expect(seen).toEqual([true, false]);
    expect(dispatcher.inTransaction).toBe(false);
    dispatcher.dispatch(setParams('a', 1));
    expect(log.lastSeq).toBe(1);
    dispatcher.begin('y').abort();
  });

  it('abort stops, ends and rethrows when an inverse handler fails', () => {
    const { handlers, dispatcher } = setup();
    let broken = false;
    handlers.register({
      type: 'fragile',
      version: 1,
      invert: () => ({ type: 'fragile', v: 1, undo: true }),
      apply: (_doc, op) => {
        if (broken && 'undo' in op) throw new Error('inverse failed');
      },
    });
    const tx = dispatcher.begin('x');
    tx.apply({ type: 'fragile', v: 1 });
    broken = true;
    expect(() => {
      tx.abort();
    }).toThrow('inverse failed');
    expect(dispatcher.inTransaction).toBe(false);
    expect(() => tx.commit()).toThrow();
  });

  it('a document subscriber exception is thrown after the op is remembered', () => {
    const { doc, dispatcher } = setup();
    const applied: (LogEntry | null)[] = [];
    dispatcher.events.on('applied', (e) => applied.push(e.entry));
    const off = doc.events.on('changed', () => {
      throw new Error('sub');
    });
    const tx = dispatcher.begin('x');
    expect(() => {
      tx.apply(setParams('a', 1));
    }).toThrow('sub');
    off();
    expect(applied).toEqual([null]);
    expect(tx.commit()?.op).toEqual(setParams('a', 1));
  });
});

describe('collecting subscriber exceptions', () => {
  it('commit: a transaction subscriber throwing keeps the entry and the other errors', () => {
    const { log, dispatcher } = setup();
    const seen: unknown[] = [];
    log.events.on('appended', () => {
      throw new Error('appended boom');
    });
    dispatcher.events.on('transaction', (e) => {
      if (!e.active) throw new Error('transaction boom');
    });
    const tx = dispatcher.begin('x');
    tx.apply(setParams('a', 1));
    dispatcher.events.on('applied', (e) => {
      seen.push(e.entry);
      throw new Error('applied boom');
    });
    let thrown: unknown;
    try {
      tx.commit();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors.map((e: Error) => e.message)).toEqual([
      'appended boom',
      'transaction boom',
      'applied boom',
    ]);
    expect(log.lastSeq).toBe(1);
    expect(seen).toEqual([log.entries()[0]]);
    expect(dispatcher.inTransaction).toBe(false);
  });

  it('commit: a transaction subscriber alone throws as it is, the entry is written', () => {
    const { log, dispatcher } = setup();
    dispatcher.events.on('transaction', (e) => {
      if (!e.active) throw new Error('transaction boom');
    });
    const tx = dispatcher.begin('x');
    tx.apply(setParams('a', 1));
    expect(() => tx.commit()).toThrow('transaction boom');
    expect(log.lastSeq).toBe(1);
  });

  it('commit: applied subscribers see the finished transaction and may dispatch', () => {
    const { log, dispatcher } = setup();
    const inTx: boolean[] = [];
    const tx = dispatcher.begin('x');
    tx.apply(setParams('a', 1));
    dispatcher.events.on('applied', (e) => {
      if (e.entry?.seq !== 1) return;
      inTx.push(dispatcher.inTransaction);
      dispatcher.dispatch(setParams('b', 9));
    });
    tx.commit();
    expect(inTx).toEqual([false]);
    expect(log.lastSeq).toBe(2);
  });

  it('abort: collects errors from applied and transaction subscribers', () => {
    const { dispatcher } = setup();
    dispatcher.events.on('transaction', (e) => {
      if (!e.active) throw new Error('transaction boom');
    });
    const tx = dispatcher.begin('x');
    tx.apply(setParams('a', 1));
    dispatcher.events.on('applied', () => {
      throw new Error('applied boom');
    });
    let thrown: unknown;
    try {
      tx.abort();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors.map((e: Error) => e.message)).toEqual([
      'applied boom',
      'transaction boom',
    ]);
    expect(dispatcher.inTransaction).toBe(false);
  });
});

describe('reentrance', () => {
  it('tx.apply, commit and abort from a document subscriber throw', () => {
    const { doc, dispatcher } = setup();
    const tx = dispatcher.begin('x');
    const inner: unknown[] = [];
    const off = doc.events.on('changed', () => {
      for (const f of [
        () => {
          tx.apply(setParams('b', 5));
        },
        () => tx.commit(),
        () => {
          tx.abort();
        },
      ]) {
        try {
          f();
          inner.push('no throw');
        } catch (e) {
          inner.push(e);
        }
      }
      throw new Error('subscriber done');
    });
    expect(() => {
      tx.apply(setParams('a', 1));
    }).toThrow();
    off();
    expect(inner.every((e) => e instanceof Error)).toBe(true);
    expect(inner).toHaveLength(3);
    expect(tx.commit()?.op).toEqual(setParams('a', 1));
  });
});

describe('applyTransient', () => {
  it('commit reverts the transient step and writes only the logged ones', () => {
    const { doc, log, dispatcher } = setup();
    const applied: { entry: LogEntry | null; op: Operation }[] = [];
    dispatcher.events.on('applied', (e) => applied.push(e));
    const tx = dispatcher.begin('Edit');
    tx.applyTransient(setRollback(1));
    expect(doc.studio.rollbackIndex).toBe(1);
    for (let i = 1; i <= 3; i++) tx.apply(setParams('a', i));
    const entry = tx.commit();
    expect(log.lastSeq).toBe(1);
    expect(entry).toMatchObject({
      kind: 'do',
      label: 'Edit',
      op: setParams('a', 3),
      inverse: setParams('a', 0),
    });
    expect(doc.studio.rollbackIndex).toBe(2);
    expect(doc.studio.features[0]?.params).toEqual({ size: 3 });
    // transient, 3x apply, revert of the transient (entry null), then the entry
    expect(applied.map((e) => e.entry)).toEqual([null, null, null, null, null, entry]);
    expect(applied[4]?.op).toEqual(setRollback(2));
  });

  it('abort reverts logged and transient steps, document and log unchanged', () => {
    const { doc, log, dispatcher } = setup();
    const before = toData(doc);
    const tx = dispatcher.begin('Edit');
    tx.applyTransient(setRollback(1));
    for (let i = 1; i <= 3; i++) tx.apply(setParams('a', i));
    tx.abort();
    expect(toData(doc)).toEqual(before);
    expect(log.lastSeq).toBe(0);
  });

  it('a transaction with only transient steps writes nothing and returns null', () => {
    const { doc, log, dispatcher } = setup();
    const before = toData(doc);
    const tx = dispatcher.begin('Edit');
    tx.applyTransient(setRollback(1));
    tx.applyTransient(setRollback(0));
    expect(tx.commit()).toBeNull();
    expect(log.lastSeq).toBe(0);
    expect(toData(doc)).toEqual(before);
    expect(dispatcher.inTransaction).toBe(false);
  });

  it('a failing handler leaves the transaction open and unchanged', () => {
    const { doc, dispatcher } = setup();
    const before = toData(doc);
    const tx = dispatcher.begin('Edit');
    expect(() => {
      tx.applyTransient(setRollback(99));
    }).toThrow();
    expect(dispatcher.inTransaction).toBe(true);
    expect(toData(doc)).toEqual(before);
    tx.apply(setParams('a', 1));
    expect(tx.commit()?.op).toEqual(setParams('a', 1));
    expect(doc.studio.rollbackIndex).toBe(2);
  });

  it('throws after the transaction has ended', () => {
    const { dispatcher } = setup();
    const tx = dispatcher.begin('x');
    tx.commit();
    expect(() => {
      tx.applyTransient(setRollback(1));
    }).toThrow();
    const tx2 = dispatcher.begin('y');
    tx2.abort();
    expect(() => {
      tx2.applyTransient(setRollback(1));
    }).toThrow();
  });
});

describe('merging steps on apply (ADR 0025)', () => {
  /** Records `applied` events emitted from now on. */
  function recordApplied(dispatcher: ReturnType<typeof setup>['dispatcher']) {
    const applied: Operation[] = [];
    dispatcher.events.on('applied', (e) => applied.push(e.op));
    return applied;
  }

  it('1000 setParams of one feature leave one step: abort applies one inverse', () => {
    const { doc, log, dispatcher } = setup();
    const before = toData(doc);
    const tx = dispatcher.begin('Drag');
    for (let i = 1; i <= 1000; i++) tx.apply(setParams('a', i));
    const applied = recordApplied(dispatcher);
    tx.abort();
    expect(applied).toEqual([setParams('a', 0)]);
    expect(toData(doc)).toEqual(before);
    expect(log.lastSeq).toBe(0);
  });

  it('emits applied for every op as before', () => {
    const { dispatcher } = setup();
    const applied = recordApplied(dispatcher);
    const tx = dispatcher.begin('Drag');
    for (let i = 1; i <= 3; i++) tx.apply(setParams('a', i));
    expect(applied).toEqual([setParams('a', 1), setParams('a', 2), setParams('a', 3)]);
  });

  it('does not merge steps of different features', () => {
    const { doc, dispatcher } = setup();
    const before = toData(doc);
    const tx = dispatcher.begin('x');
    tx.apply(setParams('a', 1));
    tx.apply(setParams('b', 2));
    tx.apply(setParams('b', 3));
    const applied = recordApplied(dispatcher);
    tx.abort();
    expect(applied).toEqual([setParams('b', 0), setParams('a', 0)]);
    expect(toData(doc)).toEqual(before);
  });

  it('does not merge steps of different types', () => {
    const { doc, dispatcher } = setup();
    const before = toData(doc);
    const remove: FeatureRemoveOp = { type: 'feature.remove', v: 1, featureId: id('b') };
    const tx = dispatcher.begin('x');
    tx.apply(setParams('a', 1));
    tx.apply(remove);
    tx.apply(setParams('a', 2));
    const applied = recordApplied(dispatcher);
    tx.abort();
    expect(applied).toHaveLength(3);
    expect(applied[0]).toEqual(setParams('a', 1));
    expect(applied[2]).toEqual(setParams('a', 0));
    expect(toData(doc)).toEqual(before);
  });

  it('a transient step in between interrupts merging', () => {
    const { doc, dispatcher } = setup();
    const before = toData(doc);
    const tx = dispatcher.begin('x');
    tx.apply(setParams('a', 1));
    tx.applyTransient(setRollback(1));
    tx.apply(setParams('a', 2));
    tx.apply(setParams('a', 3));
    const applied = recordApplied(dispatcher);
    tx.abort();
    expect(applied).toEqual([setParams('a', 1), setRollback(2), setParams('a', 0)]);
    expect(toData(doc)).toEqual(before);
  });

  it('commit still merges logged steps around a transient one into one entry', () => {
    const { log, dispatcher } = setup();
    const tx = dispatcher.begin('x');
    tx.apply(setParams('a', 1));
    tx.applyTransient(setRollback(1));
    tx.apply(setParams('a', 2));
    const entry = tx.commit();
    expect(log.lastSeq).toBe(1);
    expect(entry).toMatchObject({ op: setParams('a', 2), inverse: setParams('a', 0) });
  });
});
