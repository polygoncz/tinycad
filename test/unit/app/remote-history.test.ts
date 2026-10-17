import { describe, expect, it } from 'vitest';
import { ObservableValue } from '@/core';
import type { DocumentId } from '@/document';
import { createHistoryModel } from '@/interaction';
import type { HistoryData, LogEntryData, ReadModelData, RemoteSession } from '@/remote';
import { RemoteHistory } from '@/app/remote-history';

function aReadModel(lastSeq: number): ReadModelData {
  return {
    document: {
      id: 'doc-1' as DocumentId, // test ids are trusted
      name: 'Part',
      lastSeq,
      studio: { features: [], rollbackIndex: 0 },
    },
    regen: {
      generation: 1,
      statuses: new Map(),
      final: { bodies: [], sketches: [], planes: [], axes: [] },
      input: null,
      anchors: new Map(),
      durationMs: 0,
    },
    session: { writable: true, canUndo: false, canRedo: false, transactionLabel: null },
  };
}

const entry = (
  seq: number,
  opType = 'feature.setParams',
  kind: LogEntryData['kind'] = 'do',
  target?: number,
): LogEntryData => ({
  seq,
  kind,
  ...(target === undefined ? {} : { target }),
  label: `op${String(seq)}`,
  time: seq * 10,
  opType,
});

/** Only what RemoteHistory uses: the read model and GetHistory with answers settled by the test. */
class FakeHistorySession {
  readonly model = new ObservableValue<ReadModelData>(aReadModel(0));
  readonly calls: number[] = [];
  private readonly answers: {
    resolve: (data: HistoryData) => void;
    reject: (e: unknown) => void;
  }[] = [];

  history(fromSeq: number): Promise<HistoryData> {
    this.calls.push(fromSeq);
    return new Promise((resolve, reject) => {
      this.answers.push({ resolve, reject });
    });
  }

  /** Settles the oldest unanswered call. */
  answer(data: HistoryData): Promise<void> {
    this.answers.shift()?.resolve(data);
    return flush();
  }

  fail(): Promise<void> {
    this.answers.shift()?.reject(new Error('offline'));
    return flush();
  }

  asSession(): RemoteSession {
    // RemoteHistory reads only readModel and history (checked by the type of the picked members).
    const picked: Pick<RemoteSession, 'readModel' | 'history'> = {
      readModel: this.model.asObservable(),
      history: (fromSeq) => this.history(fromSeq),
    };
    return picked as RemoteSession;
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const fake = new FakeHistorySession();
  const history = new RemoteHistory(fake.asSession());
  let changes = 0;
  history.events.on('changed', () => changes++);
  return { fake, history, changes: () => changes };
}

describe('RemoteHistory', () => {
  it('loads the whole history at the start', async () => {
    const { fake, history, changes } = setup();
    expect(fake.calls).toEqual([1]);
    expect(history.entries()).toEqual([]);
    await fake.answer({ entries: [entry(1)], stacks: { undo: [1], redo: [] } });
    expect(history.entries()).toEqual([entry(1)]);
    expect(history.stacks()).toEqual({ undo: [1], redo: [] });
    expect(changes()).toBe(1);
  });

  it('loads again when a read model has a new lastSeq, not for the same one', async () => {
    const { fake, history } = setup();
    await fake.answer({ entries: [], stacks: { undo: [], redo: [] } });
    fake.model.set(aReadModel(0));
    expect(fake.calls).toEqual([1]);
    fake.model.set(aReadModel(1));
    expect(fake.calls).toEqual([1, 1]);
    await fake.answer({ entries: [entry(1)], stacks: { undo: [1], redo: [] } });
    expect(history.entries()).toEqual([entry(1)]);
  });

  it('drops the answer of an older load', async () => {
    const { fake, history } = setup();
    fake.model.set(aReadModel(1));
    await fake.answer({ entries: [], stacks: { undo: [], redo: [] } });
    expect(history.entries()).toEqual([]);
    await fake.answer({ entries: [entry(1)], stacks: { undo: [1], redo: [] } });
    expect(history.entries()).toEqual([entry(1)]);
  });

  it('keeps the last history after a failed load and loads again with the next read model', async () => {
    const { fake, history } = setup();
    await fake.answer({ entries: [entry(1)], stacks: { undo: [1], redo: [] } });
    fake.model.set(aReadModel(2));
    await fake.fail();
    expect(history.entries()).toEqual([entry(1)]);
    fake.model.set(aReadModel(2));
    expect(fake.calls).toEqual([1, 1, 1]);
  });

  it('feeds the history panel: without document.rename, statuses from the server stacks', async () => {
    const { fake, history } = setup();
    const model = createHistoryModel({ log: history });
    await fake.answer({
      entries: [entry(1), entry(2, 'document.rename'), entry(3), entry(4, 'batch', 'undo', 3)],
      stacks: { undo: [1], redo: [3] },
    });
    const rows = model.state.get().rows;
    expect(rows.map((row) => [row.seq, row.kind, row.status, row.target])).toEqual([
      [4, 'undo', null, 3],
      [3, 'do', 'undone', null],
      [1, 'do', 'active', null],
    ]);
    expect(model.state.get().total).toBe(3);
  });

  it('stops after dispose', async () => {
    const { fake, history, changes } = setup();
    history.dispose();
    await fake.answer({ entries: [entry(1)], stacks: { undo: [1], redo: [] } });
    fake.model.set(aReadModel(5));
    expect(history.entries()).toEqual([]);
    expect(changes()).toBe(0);
    expect(fake.calls).toEqual([1]);
  });
});
