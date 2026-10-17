// The history port over the server (N73): the log entries (LogEntryView, without the operations)
// and the undo stacks of GetHistory. The history changes only with a new log entry, and every
// answer that wrote one (and every refresh after a change elsewhere) brings a read model with a
// new lastSeq, so the history is loaded again when lastSeq changes.

import { Emitter } from '@/core';
import type { Disposable, Subscribable, Unsubscribe } from '@/core';
import type { HistoryEntry, HistoryLog } from '@/interaction';
import type { HistoryData, RemoteSession } from '@/remote';

type Stacks = HistoryData['stacks'];

const NO_STACKS: Stacks = Object.freeze({ undo: Object.freeze([]), redo: Object.freeze([]) });

export class RemoteHistory implements HistoryLog, Disposable {
  private readonly emitter = new Emitter<{ changed: undefined }>();
  readonly events: Subscribable<{ changed: undefined }> = this.emitter.asSubscribable();
  private list: readonly HistoryEntry[] = [];
  private undoStacks: Stacks = NO_STACKS;
  /** lastSeq of the read model the last load was started for. */
  private loadedSeq: number;
  /** Counter of loads: an answer of an older load than the last started is dropped. */
  private loads = 0;
  private disposed = false;
  private readonly session: RemoteSession;
  private readonly offReadModel: Unsubscribe;

  constructor(session: RemoteSession) {
    this.session = session;
    this.loadedSeq = session.readModel.get().document.lastSeq;
    this.offReadModel = session.readModel.subscribe(() => {
      const seq = this.session.readModel.get().document.lastSeq;
      if (seq !== this.loadedSeq) this.load(seq);
    });
    this.load(this.loadedSeq);
  }

  entries(): readonly HistoryEntry[] {
    return this.list;
  }

  stacks(): Stacks {
    return this.undoStacks;
  }

  dispose(): void {
    this.disposed = true;
    this.offReadModel();
  }

  private load(seq: number): void {
    this.loadedSeq = seq;
    const load = ++this.loads;
    this.session.history(1).then(
      (data) => {
        if (this.disposed || load !== this.loads) return;
        // LogEntryData has exactly the shape of HistoryEntry (N73).
        this.list = data.entries;
        this.undoStacks = data.stacks;
        this.emitter.emit('changed', undefined);
      },
      () => {
        // A failed load keeps the last history; the connection state shows the outage, and the
        // next change of lastSeq loads again. Allow the same lastSeq to load again too.
        if (load === this.loads) this.loadedSeq = Number.NaN;
      },
    );
  }
}
