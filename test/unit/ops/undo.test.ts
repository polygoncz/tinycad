import { describe, expect, it } from 'vitest';
import type { DocumentWriter, FeatureId } from '@/document';
import { createFeatureSchemaRegistry, toData } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { createOperationDispatcher } from '@/ops/dispatcher';
import { createOpHandlerRegistry } from '@/ops/handler';
import { createOperationLog } from '@/ops/log';
import type { LogEntry } from '@/ops/log';
import type {
  DocumentRenameOp,
  FeatureRemoveOp,
  FeatureRenameOp,
  StudioSetRollbackOp,
} from '@/ops/operation';
import { replayLog } from '@/ops/replay';
import { createUndoManager, rebuildUndoStacks } from '@/ops/undo';

const id = (s: string): FeatureId => s as FeatureId;
const remove = (featureId: string): FeatureRemoveOp => ({
  type: 'feature.remove',
  v: 1,
  featureId: id(featureId),
});
const rename = (featureId: string, name: string): FeatureRenameOp => ({
  type: 'feature.rename',
  v: 1,
  featureId: id(featureId),
  name,
});

function setup() {
  const doc = aDocument({
    features: [aFeature({ id: 'a', name: 'A' }), aFeature({ id: 'b', name: 'B' })],
  });
  const handlers = createOpHandlerRegistry({ schemas: createFeatureSchemaRegistry() });
  const log = createOperationLog();
  const dispatcher = createOperationDispatcher({ doc, handlers, log });
  const undo = createUndoManager({ dispatcher, log });
  return { doc, handlers, log, dispatcher, undo };
}
const nameOf = (doc: DocumentWriter, f: string): string | undefined => doc.feature(id(f))?.name;
const renameDocument = (name: string): DocumentRenameOp => ({
  type: 'document.rename',
  v: 1,
  name,
});

describe('undo / redo', () => {
  it('walks do, undo, redo and keeps the stacks in sync', () => {
    const { doc, log, dispatcher, undo } = setup();
    dispatcher.dispatch(rename('a', 'X'));
    dispatcher.dispatch(rename('a', 'Y'));
    expect(undo.stacks()).toEqual({ undo: [1, 2], redo: [] });

    undo.undo();
    expect(nameOf(doc, 'a')).toBe('X');
    expect(undo.stacks()).toEqual({ undo: [1], redo: [2] });
    undo.undo();
    expect(nameOf(doc, 'a')).toBe('A');
    undo.redo();
    expect(nameOf(doc, 'a')).toBe('X');
    undo.redo();
    expect(nameOf(doc, 'a')).toBe('Y');
    expect(undo.stacks()).toEqual({ undo: [1, 2], redo: [] });
    expect(log.entries().map((e) => [e.kind, e.target])).toEqual([
      ['do', undefined],
      ['do', undefined],
      ['undo', 2],
      ['undo', 1],
      ['redo', 1],
      ['redo', 2],
    ]);
    expect(log.entries()[2]?.label).toBe('feature.rename');
  });

  it('a new change after undo clears redo', () => {
    const { dispatcher, undo } = setup();
    dispatcher.dispatch(rename('a', 'X'));
    undo.undo();
    expect(undo.canRedo()).toBe(true);
    dispatcher.dispatch(rename('b', 'Z'));
    expect(undo.canRedo()).toBe(false);
    expect(() => {
      undo.redo();
    }).toThrow();
    expect(undo.stacks()).toEqual({ undo: [3], redo: [] });
  });

  it('throws on empty stacks and leaves the log alone', () => {
    const { log, undo } = setup();
    expect(() => {
      undo.undo();
    }).toThrow();
    expect(() => {
      undo.redo();
    }).toThrow();
    expect(log.lastSeq).toBe(0);
  });

  it('is blocked during a transaction', () => {
    const { dispatcher, undo } = setup();
    dispatcher.dispatch(rename('a', 'X'));
    const tx = dispatcher.begin('t');
    expect(undo.canUndo()).toBe(false);
    expect(() => {
      undo.undo();
    }).toThrow();
    tx.abort();
    expect(undo.canUndo()).toBe(true);
  });

  it('emits changed only when the pair changes, including transaction start and end', () => {
    const { dispatcher, undo } = setup();
    const seen: { canUndo: boolean; canRedo: boolean }[] = [];
    undo.events.on('changed', (e) => seen.push(e));

    dispatcher.dispatch(rename('a', 'X')); // (false,false) -> (true,false)
    dispatcher.dispatch(rename('a', 'Y')); // unchanged
    const tx = dispatcher.begin('t'); // -> (false,false)
    tx.abort(); // -> (true,false)
    undo.undo(); // (true,true)
    undo.undo(); // (false,true)
    undo.redo(); // (true,true)
    expect(seen).toEqual([
      { canUndo: true, canRedo: false },
      { canUndo: false, canRedo: false },
      { canUndo: true, canRedo: false },
      { canUndo: true, canRedo: true },
      { canUndo: false, canRedo: true },
      { canUndo: true, canRedo: true },
    ]);
  });

  it('undo of feature.remove brings back the feature and the rollback bar', () => {
    const { doc, dispatcher, undo } = setup();
    const setRollback: StudioSetRollbackOp = { type: 'studio.setRollback', v: 1, index: 1 };
    dispatcher.dispatch(setRollback);
    const before = toData(doc);
    dispatcher.dispatch(remove('a'));
    expect(doc.studio.features).toHaveLength(1);
    undo.undo();
    expect(toData(doc)).toEqual(before);
    expect(doc.studio.rollbackIndex).toBe(1);
  });

  it('a failed dispatch changes neither the log nor the stacks', () => {
    const { doc, log, dispatcher, undo } = setup();
    dispatcher.dispatch(rename('a', 'X'));
    // Make the inverse fail: the feature it targets is gone.
    dispatcher.dispatch(remove('a'));
    undo.undo(); // brings 'a' back
    undo.undo(); // undoes rename
    // Break the state behind the manager's back: remove 'a' with the document directly.
    doc.removeFeature(id('a'));
    expect(() => {
      undo.redo();
    }).toThrow();
    expect(log.lastSeq).toBe(4);
    expect(undo.stacks()).toEqual({ undo: [], redo: [2, 1] });
  });

  it('keeps the stacks consistent when a subscriber throws after the entry is written', () => {
    const { log, dispatcher, undo } = setup();
    dispatcher.dispatch(rename('a', 'X'));
    dispatcher.events.on('applied', () => {
      throw new Error('boom');
    });
    expect(() => {
      undo.undo();
    }).toThrow('boom');
    expect(log.lastSeq).toBe(2);
    expect(undo.stacks()).toEqual({ undo: [], redo: [1] });
  });

  it('stacks() returns copies', () => {
    const { dispatcher, undo } = setup();
    dispatcher.dispatch(rename('a', 'X'));
    const s = undo.stacks();
    (s.undo as number[]).push(99); // test-only cast to try to tamper
    expect(undo.stacks().undo).toEqual([1]);
  });

  it('dispose unsubscribes from the log and the dispatcher', () => {
    const { dispatcher, undo } = setup();
    const seen: unknown[] = [];
    undo.events.on('changed', (e) => seen.push(e));
    undo.dispose();
    dispatcher.dispatch(rename('a', 'X'));
    dispatcher.begin('t').abort();
    expect(seen).toEqual([]);
    expect(undo.stacks()).toEqual({ undo: [], redo: [] });
  });
});

describe('document.rename stays out of undo (M19.2, D5)', () => {
  it('leaves canUndo and the stacks as they were; undo reverts the step before, not the name', () => {
    const { doc, dispatcher, undo } = setup();
    dispatcher.dispatch(rename('a', 'X'));
    const before = undo.stacks();
    const changed: unknown[] = [];
    undo.events.on('changed', (e) => changed.push(e));
    dispatcher.dispatch(renameDocument('Part'));
    expect(undo.stacks()).toEqual(before);
    expect(undo.canUndo()).toBe(true);
    expect(changed).toEqual([]);
    undo.undo();
    expect(nameOf(doc, 'a')).toBe('A');
    expect(doc.meta.name).toBe('Part');
    expect(undo.canUndo()).toBe(false);
  });

  it('does not clear the redo stack', () => {
    const { doc, dispatcher, undo } = setup();
    dispatcher.dispatch(rename('a', 'X'));
    undo.undo();
    dispatcher.dispatch(renameDocument('Part'));
    expect(undo.canRedo()).toBe(true);
    undo.redo();
    expect(nameOf(doc, 'a')).toBe('X');
    expect(doc.meta.name).toBe('Part');
  });

  it('with nothing else in the log there is nothing to undo', () => {
    const { dispatcher, undo } = setup();
    dispatcher.dispatch(renameDocument('Part'));
    expect(undo.canUndo()).toBe(false);
    expect(undo.stacks()).toEqual({ undo: [], redo: [] });
  });

  it('rebuildUndoStacks skips it the same way', () => {
    const { dispatcher, log, undo } = setup();
    dispatcher.dispatch(rename('a', 'X'));
    dispatcher.dispatch(rename('a', 'Y'));
    undo.undo();
    dispatcher.dispatch(renameDocument('Part'));
    expect(rebuildUndoStacks(log.entries())).toEqual({ undo: [1], redo: [2] });
    expect(undo.stacks()).toEqual({ undo: [1], redo: [2] });
  });

  it('replayLog renames the document', () => {
    const live = setup();
    live.dispatcher.dispatch(rename('a', 'X'));
    live.dispatcher.dispatch(renameDocument('Part'));
    const doc = aDocument({
      features: [aFeature({ id: 'a', name: 'A' }), aFeature({ id: 'b', name: 'B' })],
    });
    replayLog(doc, live.handlers, live.log.entries());
    expect(doc.meta.name).toBe('Part');
    expect(toData(doc)).toEqual(toData(live.doc));
  });
});

describe('rebuildUndoStacks', () => {
  it('equals the live stacks', () => {
    const { dispatcher, log, undo } = setup();
    dispatcher.dispatch(rename('a', 'X'));
    dispatcher.dispatch(rename('a', 'Y'));
    dispatcher.dispatch(rename('b', 'Z'));
    undo.undo();
    undo.undo();
    undo.redo();
    dispatcher.dispatch(rename('b', 'W'));
    undo.undo();
    expect(rebuildUndoStacks(log.entries())).toEqual(undo.stacks());
  });

  it('throws with the seq of a corrupt entry', () => {
    const { dispatcher, log } = setup();
    dispatcher.dispatch(rename('a', 'X'));
    dispatcher.dispatch(rename('a', 'Y'));
    const good = log.entries();
    const last = good[1];
    if (last === undefined) throw new Error('setup');
    const bad: LogEntry = { ...last, seq: 3, kind: 'undo', target: 1 };
    expect(() => rebuildUndoStacks([...good, bad])).toThrow(/entry 3/);
    const bad2: LogEntry = { ...last, seq: 3, kind: 'redo', target: 1 };
    expect(() => rebuildUndoStacks([...good, bad2])).toThrow(/entry 3/);
  });

  it('is empty for an empty log', () => {
    expect(rebuildUndoStacks([])).toEqual({ undo: [], redo: [] });
  });
});

describe('reopening', () => {
  it('continues undo/redo identically after rebuilding from stored entries', () => {
    const live = setup();
    live.dispatcher.dispatch(rename('a', 'X'));
    live.dispatcher.dispatch(rename('b', 'Y'));
    live.dispatcher.dispatch(remove('a'));
    live.undo.undo();
    live.undo.undo();

    // Reopen: a fresh document in the initial state, the log replayed onto it.
    const entries = live.log.entries();
    const doc = aDocument({
      features: [aFeature({ id: 'a', name: 'A' }), aFeature({ id: 'b', name: 'B' })],
    });
    const handlers = createOpHandlerRegistry({ schemas: createFeatureSchemaRegistry() });
    replayLog(doc, handlers, entries);
    expect(toData(doc)).toEqual(toData(live.doc));
    const log = createOperationLog(entries);
    const dispatcher = createOperationDispatcher({ doc, handlers, log });
    const undo = createUndoManager({ dispatcher, log });
    expect(undo.stacks()).toEqual(live.undo.stacks());

    for (const m of [live.undo, undo]) {
      m.undo();
      m.redo();
      m.redo();
      m.undo();
    }
    expect(toData(doc)).toEqual(toData(live.doc));
    expect(undo.stacks()).toEqual(live.undo.stacks());
  });
});
