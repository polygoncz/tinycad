// The channel of transient notices of a session (spec 11, N151): something happened that the user
// should see for a moment – a lost transaction, a refused change, the server gone or back. Unlike
// the state of the title bar (an Observable that holds until it changes), a notice is an event
// that disappears by itself or when the user dismisses it. app says what happened by a key of the
// translation; ui translates and shows it as a toast (ADR 0014).

import { ObservableValue } from '@/core';
import type { Disposable, Observable } from '@/core';
import { isRetryable, RemoteError } from '@/remote';

export type NoticeKind = 'info' | 'warning' | 'error';
export type NoticeParams = Readonly<Record<string, string | number>>;

/** One transient notice; immutable. */
export interface AppNotice {
  /** Growing number within the session (the key for Vue and for dismiss). */
  readonly id: number;
  readonly kind: NoticeKind;
  /** Key of the translation ('notice.transactionLost', 'sketch.notSolved'); ui makes the text (ADR 0014). */
  readonly key: string;
  readonly params: NoticeParams;
  /** true = stays until the user dismisses it or its source withdraws it (dismissKey). */
  readonly sticky: boolean;
}

export interface NoticeInput {
  readonly kind: NoticeKind;
  readonly key: string;
  readonly params?: NoticeParams;
}

/** Duration by kind; null = sticky. */
export const NOTICE_DURATION_MS: Readonly<Record<NoticeKind, number | null>> = Object.freeze({
  info: 4000,
  warning: 8000,
  error: null,
});

/** At most this many notices at once; the oldest drops out. */
export const MAX_NOTICES = 3;

export interface NoticeCenter extends Disposable {
  readonly notices: Observable<readonly AppNotice[]>;
  show(input: NoticeInput): void;
  /** Unknown id: nothing. */
  dismiss(id: number): void;
  /** Withdraws all notices with this key (a restored connection withdraws "server unavailable"). */
  dismissKey(key: string): void;
}

export function createNoticeCenter(): NoticeCenter {
  return new NoticeCenterImpl();
}

const NO_NOTICES: readonly AppNotice[] = Object.freeze([]);

class NoticeCenterImpl implements NoticeCenter {
  private readonly list = new ObservableValue<readonly AppNotice[]>(NO_NOTICES);
  /** The timer of every visible notice that is not sticky, by id. */
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private nextId = 1;
  private disposed = false;

  get notices(): Observable<readonly AppNotice[]> {
    return this.list.asObservable();
  }

  show(input: NoticeInput): void {
    if (this.disposed) return;
    const params: NoticeParams = Object.freeze({ ...input.params });
    const duration = NOTICE_DURATION_MS[input.kind];
    const notice: AppNotice = Object.freeze({
      id: this.nextId++,
      kind: input.kind,
      key: input.key,
      params,
      sticky: duration === null,
    });
    // The same notice again replaces the visible one: no duplicates of a repeated error. Over the
    // limit the oldest drops out, sticky or not.
    const same = JSON.stringify(params);
    const current = this.list.get();
    const next = [
      ...current.filter((n) => !(n.key === notice.key && JSON.stringify(n.params) === same)),
      notice,
    ].slice(-MAX_NOTICES);
    for (const n of current) if (!next.includes(n)) this.cancelTimer(n.id);
    if (duration !== null) {
      this.timers.set(
        notice.id,
        setTimeout(() => {
          this.dismiss(notice.id);
        }, duration),
      );
    }
    this.list.set(Object.freeze(next));
  }

  dismiss(id: number): void {
    this.remove((n) => n.id === id);
  }

  dismissKey(key: string): void {
    this.remove((n) => n.key === key);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.list.set(NO_NOTICES);
  }

  private remove(matches: (notice: AppNotice) => boolean): void {
    const current = this.list.get();
    const gone = current.filter(matches);
    if (gone.length === 0) return;
    for (const n of gone) this.cancelTimer(n.id);
    this.list.set(Object.freeze(current.filter((n) => !matches(n))));
  }

  private cancelTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(id);
  }
}

/**
 * A change refused by the server → a notice, or null when another channel shows it or nobody needs
 * to see it. The one place that makes a notice of an error (the remote dispatcher calls it).
 */
export function noticeOfRefusal(error: unknown): NoticeInput | null {
  if (!(error instanceof RemoteError)) return { kind: 'warning', key: 'notice.changeDropped' };
  if (error.reason === 'SKETCH_NOT_SOLVED') return { kind: 'warning', key: 'sketch.notSolved' };
  if (error.reason === 'READ_ONLY') return { kind: 'error', key: 'notice.readOnly' };
  // N169: a quick Ctrl+Z before the read model of the previous one is a harmless race.
  if (error.reason === 'NOTHING_TO_UNDO' || error.reason === 'NOTHING_TO_REDO') return null;
  // The outage is shown by the title bar and the notice of the connection (N92).
  if (isRetryable(error)) return null;
  // RemoteError has no missing reason, it is 'UNSPECIFIED' then: the code says more.
  const reason = error.reason === 'UNSPECIFIED' ? error.code : error.reason;
  return { kind: 'error', key: 'notice.changeRejected', params: { reason } };
}
