// The state of the connection to the core for the UI (N69, spec 11 "Stav jádra a ukládání"): the
// connection and the changes in flight of a RemoteSession mapped onto the KernelUiState and the
// PersistenceStatus the title bar and the banner already show, so ui gets only new texts.
// Connecting = 'starting', online = 'ready', retrying = 'restarting', offline = 'unavailable';
// changes in flight = 'pending', retrying = 'error', given up with unconfirmed changes = 'failed'.

import { ObservableValue } from '@/core';
import type { Disposable, Observable } from '@/core';
import type { PersistenceStatus } from '@/persistence';
import type { ConnectionState, RemoteSession } from '@/remote';
import type { KernelUiState } from './kernel-supervisor';

export interface ConnectionStateDeps {
  readonly session: Pick<RemoteSession, 'connection' | 'pending' | 'refresh'>;
  /** A failed retryKernel (refresh), besides the text it leaves in the state. */
  readonly reportError: (error: unknown) => void;
}

export interface ConnectionUiState extends Disposable {
  readonly kernel: Observable<KernelUiState>;
  /** The text of the last noted error while `kernel` is 'unavailable'; null otherwise. */
  readonly kernelError: Observable<string | null>;
  /** A new attempt: session.refresh() (spec 14, a refresh tries the connection again). */
  retryKernel(): void;
  readonly persistence: Observable<PersistenceStatus>;
  /** The text of the last noted error while `persistence` is 'error' or 'failed'; null otherwise. */
  readonly persistenceError: Observable<string | null>;
  /** A request of the session failed (a ChangeOutcome error, a failed refresh): its text. */
  noteError(error: unknown): void;
}

export function createConnectionState(deps: ConnectionStateDeps): ConnectionUiState {
  const { session } = deps;
  let lastError: string | null = null;
  const kernel = new ObservableValue<KernelUiState>(kernelOf(session.connection.get()));
  const kernelError = new ObservableValue<string | null>(null);
  const persistence = new ObservableValue<PersistenceStatus>('saved');
  const persistenceError = new ObservableValue<string | null>(null);

  function update(): void {
    const connection = session.connection.get();
    const status = persistenceOf(connection, session.pending.get());
    kernel.set(kernelOf(connection));
    persistence.set(status);
    kernelError.set(connection === 'offline' ? lastError : null);
    persistenceError.set(status === 'error' || status === 'failed' ? lastError : null);
  }

  const offConnection = session.connection.subscribe(update);
  const offPending = session.pending.subscribe(update);
  update();

  function noteError(error: unknown): void {
    lastError = error instanceof Error ? error.message : String(error);
    update();
  }

  return {
    kernel: kernel.asObservable(),
    kernelError: kernelError.asObservable(),
    persistence: persistence.asObservable(),
    persistenceError: persistenceError.asObservable(),
    noteError,
    retryKernel() {
      session.refresh().catch((error: unknown) => {
        noteError(error);
        deps.reportError(error);
      });
    },
    dispose() {
      offConnection();
      offPending();
    },
  };
}

const KERNEL_STATES: Readonly<Record<ConnectionState, KernelUiState>> = Object.freeze({
  connecting: 'starting',
  online: 'ready',
  retrying: 'restarting',
  offline: 'unavailable',
});

function kernelOf(connection: ConnectionState): KernelUiState {
  return KERNEL_STATES[connection];
}

/**
 * Retrying is 'error' whatever is in flight (a retried request always is); offline with changes
 * still queued is 'failed' (they are not on the server); otherwise changes queued or in flight
 * are 'pending'.
 */
function persistenceOf(connection: ConnectionState, pending: number): PersistenceStatus {
  if (connection === 'retrying') return 'error';
  if (connection === 'offline') return pending > 0 ? 'failed' : 'saved';
  return pending > 0 ? 'pending' : 'saved';
}
