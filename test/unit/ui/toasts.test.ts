import { describe, expect, it } from 'vitest';
import type { AppNotice, NoticeParams } from '@/app';
import {
  closeErrorToasts,
  isCloseErrorToast,
  noticeIdOf,
  pageToasts,
  toastItemsOf,
} from '@/ui/toasts';

function aNotice(overrides: Partial<AppNotice> = {}): AppNotice {
  return { id: 1, kind: 'info', key: 'k', params: {}, sticky: false, ...overrides };
}

const t = (key: string, params: NoticeParams): string => `${key}${JSON.stringify(params)}`;

describe('toastItemsOf', () => {
  it('translates every notice with its params, in their order', () => {
    const items = toastItemsOf(
      [
        aNotice({ id: 3, key: 'notice.changeRejected', params: { reason: 'X' }, kind: 'error' }),
        aNotice({ id: 7, key: 'notice.connectionRestored' }),
      ],
      t,
    );
    expect(items).toEqual([
      { id: 'notice-3', tone: 'error', text: 'notice.changeRejected{"reason":"X"}' },
      { id: 'notice-7', tone: 'info', text: 'notice.connectionRestored{}' },
    ]);
  });

  it('the tone is the kind of the notice', () => {
    const tones = toastItemsOf(
      (['info', 'warning', 'error'] as const).map((kind, i) => aNotice({ id: i, kind })),
      t,
    ).map((item) => item.tone);
    expect(tones).toEqual(['info', 'warning', 'error']);
  });

  it('no notices: no items', () => {
    expect(toastItemsOf([], t)).toEqual([]);
  });
});

describe('noticeIdOf', () => {
  it('the id of the notice of its toast', () => {
    expect(noticeIdOf('notice-12')).toBe(12);
  });

  it.each(['close-error', 'notice-', 'notice-x', 'other-3'])(
    'null for another toast (%s)',
    (id) => {
      expect(noticeIdOf(id)).toBeNull();
    },
  );
});

describe('closeErrorToasts', () => {
  it('the error of closing as one error toast', () => {
    expect(closeErrorToasts('disk full', t)).toEqual([
      { id: 'close-error', tone: 'error', text: 'app.closeError{"error":"disk full"}' },
    ]);
  });

  it('no error: no toast', () => {
    expect(closeErrorToasts(null, t)).toEqual([]);
  });
});

describe('pageToasts (N170)', () => {
  it('one list: the error of closing first, then the notices of the session', () => {
    const close = closeErrorToasts('disk full', t);
    const notices = toastItemsOf([aNotice({ id: 4 })], t);
    const items = pageToasts(close, notices);
    expect(items.map((item) => item.id)).toEqual(['close-error', 'notice-4']);
    expect(Object.isFrozen(items)).toBe(true);
  });

  it('without an error of closing: the notices only', () => {
    const notices = toastItemsOf([aNotice({ id: 4 })], t);
    expect(pageToasts([], notices)).toEqual(notices);
  });
});

describe('isCloseErrorToast', () => {
  it('true only for the toast of the error of closing', () => {
    expect(isCloseErrorToast('close-error')).toBe(true);
    expect(isCloseErrorToast('notice-1')).toBe(false);
  });
});
