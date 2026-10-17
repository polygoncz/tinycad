import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteError } from '@/remote';
import {
  createNoticeCenter,
  MAX_NOTICES,
  NOTICE_DURATION_MS,
  noticeOfRefusal,
} from '@/app/notices';
import type { NoticeCenter } from '@/app/notices';

function keys(center: NoticeCenter): string[] {
  return center.notices.get().map((n) => n.key);
}

describe('createNoticeCenter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a notice with a growing id, the params and sticky by its kind', () => {
    const center = createNoticeCenter();
    center.show({ kind: 'info', key: 'a' });
    center.show({ kind: 'error', key: 'b', params: { reason: 'X' } });
    const [a, b] = center.notices.get();
    expect(a).toEqual({ id: 1, kind: 'info', key: 'a', params: {}, sticky: false });
    expect(b).toEqual({ id: 2, kind: 'error', key: 'b', params: { reason: 'X' }, sticky: true });
    expect(Object.isFrozen(center.notices.get())).toBe(true);
    expect(Object.isFrozen(a)).toBe(true);
    center.dispose();
  });

  it('every change is a new array and notifies the subscribers', () => {
    const center = createNoticeCenter();
    const before = center.notices.get();
    const listener = vi.fn();
    center.notices.subscribe(listener);
    center.show({ kind: 'info', key: 'a' });
    expect(center.notices.get()).not.toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
    center.dispose();
  });

  it('dismiss removes the notice; an unknown id does nothing', () => {
    const center = createNoticeCenter();
    center.show({ kind: 'error', key: 'a' });
    center.show({ kind: 'error', key: 'b' });
    const listener = vi.fn();
    center.notices.subscribe(listener);
    center.dismiss(99);
    expect(listener).not.toHaveBeenCalled();
    center.dismiss(1);
    expect(keys(center)).toEqual(['b']);
    center.dispose();
  });

  it('dismissKey removes all notices with the key', () => {
    const center = createNoticeCenter();
    center.show({ kind: 'error', key: 'a', params: { n: 1 } });
    center.show({ kind: 'error', key: 'b' });
    center.show({ kind: 'error', key: 'a', params: { n: 2 } });
    center.dismissKey('a');
    expect(keys(center)).toEqual(['b']);
    center.dispose();
  });

  it('the durations by kind: info 4 s, warning 8 s, error stays', () => {
    expect(NOTICE_DURATION_MS).toEqual({ info: 4000, warning: 8000, error: null });
    const center = createNoticeCenter();
    center.show({ kind: 'info', key: 'i' });
    center.show({ kind: 'warning', key: 'w' });
    center.show({ kind: 'error', key: 'e' });
    vi.advanceTimersByTime(3999);
    expect(keys(center)).toEqual(['i', 'w', 'e']);
    vi.advanceTimersByTime(1);
    expect(keys(center)).toEqual(['w', 'e']);
    vi.advanceTimersByTime(4000);
    expect(keys(center)).toEqual(['e']);
    vi.advanceTimersByTime(60_000);
    expect(keys(center)).toEqual(['e']);
    center.dispose();
  });

  it('the same key and params replace the visible notice: a new id at the end, a new timer', () => {
    const center = createNoticeCenter();
    center.show({ kind: 'info', key: 'a', params: { n: 1 } });
    center.show({ kind: 'info', key: 'b' });
    vi.advanceTimersByTime(3000);
    center.show({ kind: 'info', key: 'a', params: { n: 1 } });
    expect(center.notices.get().map((n) => [n.id, n.key])).toEqual([
      [2, 'b'],
      [3, 'a'],
    ]);
    vi.advanceTimersByTime(1000);
    expect(keys(center)).toEqual(['a']);
    vi.advanceTimersByTime(2999);
    expect(keys(center)).toEqual(['a']);
    vi.advanceTimersByTime(1);
    expect(keys(center)).toEqual([]);
    center.dispose();
  });

  it('other params are another notice', () => {
    const center = createNoticeCenter();
    center.show({ kind: 'error', key: 'a', params: { n: 1 } });
    center.show({ kind: 'error', key: 'a', params: { n: 2 } });
    expect(center.notices.get()).toHaveLength(2);
    center.dispose();
  });

  it(`at most ${String(MAX_NOTICES)} at once: the oldest drops out, sticky too`, () => {
    expect(MAX_NOTICES).toBe(3);
    const center = createNoticeCenter();
    center.show({ kind: 'error', key: 'a' });
    center.show({ kind: 'info', key: 'b' });
    center.show({ kind: 'info', key: 'c' });
    center.show({ kind: 'info', key: 'd' });
    expect(keys(center)).toEqual(['b', 'c', 'd']);
    center.dispose();
  });

  it('dismiss, dismissKey and dispose cancel their timers', () => {
    const center = createNoticeCenter();
    center.show({ kind: 'info', key: 'a' });
    center.show({ kind: 'info', key: 'b' });
    center.dismiss(1);
    center.dismissKey('b');
    expect(vi.getTimerCount()).toBe(0);
    center.show({ kind: 'warning', key: 'c' });
    center.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(center.notices.get()).toEqual([]);
  });

  it('after dispose show is a no-op', () => {
    const center = createNoticeCenter();
    center.dispose();
    center.show({ kind: 'error', key: 'a' });
    expect(center.notices.get()).toEqual([]);
  });

  it('a notice dropped for the limit cancels its timer', () => {
    const center = createNoticeCenter();
    for (const key of ['a', 'b', 'c', 'd']) center.show({ kind: 'info', key });
    expect(vi.getTimerCount()).toBe(MAX_NOTICES);
    center.dispose();
  });
});

describe('noticeOfRefusal', () => {
  it('SKETCH_NOT_SOLVED: the warning sketch.notSolved', () => {
    const error = new RemoteError({
      code: 'FAILED_PRECONDITION',
      reason: 'SKETCH_NOT_SOLVED',
      message: 'm',
    });
    expect(noticeOfRefusal(error)).toEqual({ kind: 'warning', key: 'sketch.notSolved' });
  });

  it('READ_ONLY: the error notice.readOnly', () => {
    const error = new RemoteError({
      code: 'FAILED_PRECONDITION',
      reason: 'READ_ONLY',
      message: 'm',
    });
    expect(noticeOfRefusal(error)).toEqual({ kind: 'error', key: 'notice.readOnly' });
  });

  it.each(['UNAVAILABLE', 'DEADLINE_EXCEEDED'] as const)(
    'a retryable error (%s): null, the connection shows it',
    (code) => {
      expect(noticeOfRefusal(new RemoteError({ code, message: 'down' }))).toBeNull();
    },
  );

  it('another RemoteError: notice.changeRejected with the reason', () => {
    const error = new RemoteError({
      code: 'INVALID_ARGUMENT',
      reason: 'INVALID_OPERATION',
      message: 'm',
    });
    expect(noticeOfRefusal(error)).toEqual({
      kind: 'error',
      key: 'notice.changeRejected',
      params: { reason: 'INVALID_OPERATION' },
    });
  });

  it('a RemoteError without a reason: notice.changeRejected with the code', () => {
    const error = new RemoteError({ code: 'INTERNAL', message: 'm' });
    expect(noticeOfRefusal(error)).toEqual({
      kind: 'error',
      key: 'notice.changeRejected',
      params: { reason: 'INTERNAL' },
    });
  });

  it.each(['NOTHING_TO_UNDO', 'NOTHING_TO_REDO'] as const)(
    '%s: null, a quick Ctrl+Z before the read model is a harmless race (N169)',
    (reason) => {
      const error = new RemoteError({ code: 'FAILED_PRECONDITION', reason, message: 'm' });
      expect(noticeOfRefusal(error)).toBeNull();
    },
  );

  it('anything else (a change that no longer applies): the warning notice.changeDropped', () => {
    expect(noticeOfRefusal(new Error('stale'))).toEqual({
      kind: 'warning',
      key: 'notice.changeDropped',
    });
  });
});
