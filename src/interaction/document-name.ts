// The name of the document in the title bar (spec 10, M19.2, D5): a presentation model over
// DocumentMeta.name. Renaming is the operation document.rename, so the name is saved, survives a
// reload and travels in an exported file, yet stays outside undo (UndoManager skips it).

import { ObservableValue } from '@/core';
import type { Observable, Unsubscribe } from '@/core';
import type { DocumentReader } from '@/document';
import { OP_VERSION } from '@/ops';
import type { DocumentRenameOp, OperationDispatcher } from '@/ops';

export interface DocumentNameModel {
  /** DocumentMeta.name; follows every rename (changed of the document). */
  readonly name: Observable<string>;
  /**
   * = !locked: read-only, or an open feature dialog holds its transaction and dispatch would
   * throw.
   */
  readonly canRename: Observable<boolean>;
  /**
   * Trims `name` and → dispatch document.rename (label = the op type, translated by ui).
   * An empty name or the lock: false and nothing is written. The same name: true without an
   * operation.
   */
  rename(name: string): boolean;
  dispose(): void;
}

export function createDocumentNameModel(deps: {
  doc: Pick<DocumentReader, 'meta' | 'events'>;
  ops: Pick<OperationDispatcher, 'dispatch'>;
  /** The edit lock (createEditLock): read-only or an open feature dialog. */
  locked: Observable<boolean>;
}): DocumentNameModel {
  const { doc, ops, locked } = deps;

  const name = new ObservableValue(doc.meta.name);
  // rename sends changed with the unchanged studio; ObservableValue drops an equal name, so
  // other changes of the document notify no one.
  const unsubscribe = doc.events.on('changed', () => {
    name.set(doc.meta.name);
  });
  // Derived from the lock without an own state: it changes exactly when the lock does.
  const canRename: Observable<boolean> = Object.freeze({
    get: () => !locked.get(),
    subscribe: (fn: () => void): Unsubscribe => locked.subscribe(fn),
  });

  function rename(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed === '' || locked.get()) return false;
    if (trimmed === doc.meta.name) return true;
    const op: DocumentRenameOp = {
      type: 'document.rename',
      v: OP_VERSION['document.rename'],
      name: trimmed,
    };
    ops.dispatch(op);
    return true;
  }

  return Object.freeze({
    name: name.asObservable(),
    canRename,
    rename,
    dispose: unsubscribe,
  });
}
