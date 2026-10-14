import type { AppSession, KernelUiState } from '@/app';

// The states the TitleBar shows (spec 11, "Komponenty"; M19.1 Ú13, revize U1 and U11): the dot
// of the save state while saving works, otherwise notices with a text – the save that fails, the
// kernel that starts, restarts or does not run, the regeneration that threw. Which notice, its
// text, detail and action are decided here; the component only draws them (ADR 0010).

/** 'saved' | 'pending' | 'error' | 'failed'; app does not re-export the type of persistence. */
type PersistenceStatus = ReturnType<AppSession['persistence']['get']>;

/** What the TitleBar reads from the session. */
export interface TitleBarInput {
  readonly persistence: PersistenceStatus;
  /** AppSession.persistenceError: the error of the last failed write. */
  readonly persistenceError: string | null;
  readonly kernel: KernelUiState;
  /** AppSession.kernelError: why the kernel did not start or crashed. */
  readonly kernelError: string | null;
  /** RegenUiState.failed: the error of the last regeneration that threw. */
  readonly regenFailed: string | null;
}

/** A command of a notice; the TitleBar maps it to the session. */
export type NoticeAction = 'retryKernel' | 'exportDocument';

export interface TitleBarNotice {
  /** Which state it reports; unique in the list. */
  readonly id: 'persistence' | 'kernel' | 'regen';
  /** progress: a spinner and role="status"; error: a warning icon and role="alert". */
  readonly tone: 'progress' | 'error';
  /** Translation key of the text. */
  readonly text: string;
  /** Technical text for the expandable Details; null = no Details. */
  readonly detail: string | null;
  /** The button of the notice, its label a translation key. */
  readonly action: { readonly kind: NoticeAction; readonly label: string } | null;
}

/** The dot next to the document name: only while saving works; a notice replaces it otherwise. */
export function saveDotOf(status: PersistenceStatus): 'saved' | 'pending' | null {
  return status === 'saved' || status === 'pending' ? status : null;
}

/** The notices of the title bar in the order persistence, kernel, regeneration; frozen. */
export function titleBarNotices(input: TitleBarInput): readonly TitleBarNotice[] {
  const notices = [
    persistenceNotice(input.persistence, input.persistenceError),
    kernelNotice(input.kernel, input.kernelError),
    input.regenFailed === null
      ? null
      : notice('regen', 'error', 'titleBar.regen.failed', input.regenFailed, null),
  ];
  return Object.freeze(notices.filter((n): n is TitleBarNotice => n !== null));
}

function persistenceNotice(status: PersistenceStatus, error: string | null): TitleBarNotice | null {
  switch (status) {
    case 'saved':
    case 'pending':
      return null;
    case 'error':
      // The service retries by itself.
      return notice('persistence', 'error', 'titleBar.persistence.error', error, null);
    case 'failed':
      // Nothing is saved until the end of the session; the export is the way out (D4).
      return notice('persistence', 'error', 'titleBar.persistence.failed', error, {
        kind: 'exportDocument',
        label: 'titleBar.persistence.export',
      });
  }
}

function kernelNotice(state: KernelUiState, error: string | null): TitleBarNotice | null {
  const retry = { kind: 'retryKernel', label: 'titleBar.kernel.retry' } as const;
  switch (state) {
    case 'ready':
      return null;
    case 'starting':
      return notice('kernel', 'progress', 'titleBar.kernel.starting', null, null);
    case 'restarting':
      return notice('kernel', 'progress', 'titleBar.kernel.restarting', null, null);
    case 'failed':
      return notice('kernel', 'error', 'titleBar.kernel.failed', error, retry);
    case 'unavailable':
      return notice('kernel', 'error', 'titleBar.kernel.unavailable', error, retry);
  }
}

function notice(
  id: TitleBarNotice['id'],
  tone: TitleBarNotice['tone'],
  text: string,
  detail: string | null,
  action: TitleBarNotice['action'],
): TitleBarNotice {
  return Object.freeze({
    id,
    tone,
    text,
    detail,
    action: action === null ? null : Object.freeze({ ...action }),
  });
}
