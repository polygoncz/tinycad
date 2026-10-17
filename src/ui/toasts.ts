import type { AppNotice, NoticeParams } from '@/app';

// The toasts of the page (spec 11, "Komponenty", N151): the transient notices of the session and
// the error of closing a document, drawn by one ToastStack. This presenter turns the notices of
// the session into items with a translated text and maps the id of a toast back to its notice;
// the component only draws them (ADR 0010).

export interface ToastItem {
  /** 'notice-12' for a notice of the session, 'close-error' for the error of closing. */
  readonly id: string;
  readonly tone: 'info' | 'warning' | 'error';
  /** Already translated. */
  readonly text: string;
}

const NOTICE_PREFIX = 'notice-';
const CLOSE_ERROR_ID = 'close-error';

/** The notices of the session → items of the toast; text = t(key, params). */
export function toastItemsOf(
  notices: readonly AppNotice[],
  t: (key: string, params: NoticeParams) => string,
): readonly ToastItem[] {
  return Object.freeze(
    notices.map((notice) =>
      Object.freeze({
        id: `${NOTICE_PREFIX}${String(notice.id)}`,
        tone: notice.kind,
        text: t(notice.key, notice.params),
      }),
    ),
  );
}

/** The id of the notice of a toast made by toastItemsOf; null for any other toast. */
export function noticeIdOf(toastId: string): number | null {
  if (!toastId.startsWith(NOTICE_PREFIX)) return null;
  const digits = toastId.slice(NOTICE_PREFIX.length);
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

/** The error of closing the previous document (DocumentSwitcher closeError) as a toast; [] = none. */
export function closeErrorToasts(
  closeError: string | null,
  t: (key: string, params: NoticeParams) => string,
): readonly ToastItem[] {
  if (closeError === null) return Object.freeze([]);
  return Object.freeze([
    Object.freeze({
      id: CLOSE_ERROR_ID,
      tone: 'error',
      text: t('app.closeError', { error: closeError }),
    }),
  ]);
}
