import { assert, DisposableStore, Emitter } from '@/core';
import type { Disposable, Subscribable } from '@/core';
import type { OperationDispatcher } from './dispatcher';
import type { LogEntry, OperationLogReader } from './log';
import { isDocumentRename } from './operation';

export interface UndoManager extends Disposable {
  /** The undo stack is not empty and no transaction is running. */
  canUndo(): boolean;
  canRedo(): boolean;
  /** Current stacks (seq of the original 'do' entries, top at the end). Copies. */
  stacks(): { readonly undo: readonly number[]; readonly redo: readonly number[] };
  /** Takes the top of the undo stack and dispatches its inverse as an 'undo' entry. */
  undo(): void;
  /** Takes the top of the redo stack and dispatches its op again as a 'redo' entry. */
  redo(): void;
  /** Emitted only when the pair (canUndo, canRedo) changes. */
  readonly events: Subscribable<{ changed: { canUndo: boolean; canRedo: boolean } }>;
}

interface Stacks {
  readonly undo: readonly number[];
  readonly redo: readonly number[];
}

/** One step shared by rebuildUndoStacks and the live manager. Pure; throws on a corrupt log. */
function step(stacks: Stacks, entry: LogEntry): Stacks {
  const { undo, redo } = stacks;
  switch (entry.kind) {
    case 'do':
      // The name of the document is metadata outside undo (M19.2, D5): Ctrl+Z does not bring
      // back the old name and a rename keeps redo. It commutes with every other operation, so
      // undo of the steps around it stays correct.
      if (isDocumentRename(entry.op)) return stacks;
      return { undo: [...undo, entry.seq], redo: [] };
    case 'undo': {
      const top = undo[undo.length - 1];
      assert(
        top !== undefined && top === entry.target,
        `Corrupt log: undo entry ${String(entry.seq)} does not target the top of the undo stack`,
      );
      return { undo: undo.slice(0, -1), redo: [...redo, top] };
    }
    case 'redo': {
      const top = redo[redo.length - 1];
      assert(
        top !== undefined && top === entry.target,
        `Corrupt log: redo entry ${String(entry.seq)} does not target the top of the redo stack`,
      );
      return { undo: [...undo, top], redo: redo.slice(0, -1) };
    }
  }
}

/** Stacks from entry metadata (seq of the original 'do' entries, top at the end). Pure. */
export function rebuildUndoStacks(entries: readonly LogEntry[]): {
  undo: number[];
  redo: number[];
} {
  const { undo, redo } = entries.reduce<Stacks>(step, { undo: [], redo: [] });
  return { undo: [...undo], redo: [...redo] };
}

/** Stacks are computed from the log on creation, then kept up to date from log.appended. */
export function createUndoManager(deps: {
  dispatcher: OperationDispatcher;
  log: OperationLogReader;
}): UndoManager {
  const { dispatcher, log } = deps;
  const emitter = new Emitter<{ changed: { canUndo: boolean; canRedo: boolean } }>();
  const subscriptions = new DisposableStore();
  let current: Stacks = rebuildUndoStacks(log.entries());

  const canUndo = (): boolean => current.undo.length > 0 && !dispatcher.inTransaction;
  const canRedo = (): boolean => current.redo.length > 0 && !dispatcher.inTransaction;

  let last = { canUndo: canUndo(), canRedo: canRedo() };
  function notifyIfChanged(): void {
    const next = { canUndo: canUndo(), canRedo: canRedo() };
    if (next.canUndo === last.canUndo && next.canRedo === last.canRedo) return;
    last = next;
    emitter.emit('changed', next);
  }

  // Stacks change only here, so a failed dispatch (nothing appended) changes nothing.
  subscriptions.add(
    log.events.on('appended', (entry) => {
      current = step(current, entry);
      notifyIfChanged();
    }),
  );
  subscriptions.add(dispatcher.events.on('transaction', notifyIfChanged));

  function targetEntry(seq: number): LogEntry {
    const found = log.entries(seq)[0];
    assert(found !== undefined && found.seq === seq, `Undo: log entry ${String(seq)} is missing`);
    return found;
  }

  return {
    canUndo,
    canRedo,
    stacks: () => ({ undo: [...current.undo], redo: [...current.redo] }),
    undo() {
      assert(canUndo(), 'undo: nothing to undo');
      const target = current.undo[current.undo.length - 1];
      assert(target !== undefined, 'undo: nothing to undo');
      const entry = targetEntry(target);
      dispatcher.dispatch(entry.inverse, { kind: 'undo', target, label: entry.label });
    },
    redo() {
      assert(canRedo(), 'redo: nothing to redo');
      const target = current.redo[current.redo.length - 1];
      assert(target !== undefined, 'redo: nothing to redo');
      const entry = targetEntry(target);
      dispatcher.dispatch(entry.op, { kind: 'redo', target, label: entry.label });
    },
    // Only on/once, not the Emitter itself, so callers cannot emit.
    events: emitter.asSubscribable(),
    dispose: () => {
      subscriptions.dispose();
    },
  };
}
