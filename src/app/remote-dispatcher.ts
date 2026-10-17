// OperationDispatcher, Transaction and UndoManager over a RemoteSession (N63–N65): every change is
// applied at once to the mirror of the document with the TS handlers of ops and sent to the core;
// every answer rebuilds the mirror as the document of the server plus the changes not confirmed
// yet. Undo and redo wait for the answer (N64). M46 task 1 fixes the contract; task 3 implements
// it.

import type { OpHandlerRegistry, OperationDispatcher, UndoManager } from '@/ops';
import type { RemoteError, RemoteSession } from '@/remote';
import type { MirrorDocument } from './mirror-document';

export interface RemoteDispatcherDeps {
  readonly mirror: MirrorDocument;
  readonly session: RemoteSession;
  readonly handlers: OpHandlerRegistry;
  /** Time source of the provisional LogEntry.time. */
  readonly now: () => number;
  /** A change the server refused (dropped from the mirror), or one that no longer applies. */
  readonly onError: (error: RemoteError) => void;
  /** The open transaction ended on the server (RemoteSession `lost`). */
  readonly onLost: () => void;
}

export function createRemoteDispatcher(
  deps: RemoteDispatcherDeps,
): OperationDispatcher & { readonly undo: UndoManager } {
  throw new Error('createRemoteDispatcher: not implemented (M46 task 3)', { cause: deps });
}
