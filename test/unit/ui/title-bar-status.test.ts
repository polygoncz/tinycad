import { describe, expect, it } from 'vitest';
import type { KernelUiState } from '@/app';
import { cs } from '@/ui/i18n/cs';
import { en } from '@/ui/i18n/en';
import { saveDotOf, titleBarNotices } from '@/ui/title-bar-status';
import type { TitleBarInput } from '@/ui/title-bar-status';

/** Everything works: saved, the kernel ready, the last regeneration without an error. */
const FINE: TitleBarInput = {
  persistence: 'saved',
  persistenceError: null,
  kernel: 'ready',
  kernelError: null,
  regenFailed: null,
};

const KERNEL_STATES: readonly KernelUiState[] = [
  'starting',
  'ready',
  'restarting',
  'failed',
  'unavailable',
];

describe('saveDotOf', () => {
  it('is the dot while saving works', () => {
    expect(saveDotOf('saved')).toBe('saved');
    expect(saveDotOf('pending')).toBe('pending');
  });

  it('is none for an error or a store that failed for good: a notice with text replaces it', () => {
    expect(saveDotOf('error')).toBeNull();
    expect(saveDotOf('failed')).toBeNull();
  });
});

describe('titleBarNotices', () => {
  it('is empty while everything works', () => {
    expect(titleBarNotices(FINE)).toEqual([]);
  });

  describe('persistence', () => {
    it('saved and pending have no notice (the dot shows them)', () => {
      expect(titleBarNotices({ ...FINE, persistence: 'pending' })).toEqual([]);
    });

    it('error: an alert that it retries, the error of the write as the detail', () => {
      const notices = titleBarNotices({
        ...FINE,
        persistence: 'error',
        persistenceError: 'quota exceeded',
      });
      expect(notices).toEqual([
        {
          id: 'persistence',
          tone: 'error',
          text: 'titleBar.persistence.error',
          detail: 'quota exceeded',
          action: null,
        },
      ]);
    });

    it('failed: an alert to export the document, with the Export action and the detail', () => {
      const notices = titleBarNotices({
        ...FINE,
        persistence: 'failed',
        persistenceError: "Document 'd' does not exist",
      });
      expect(notices).toEqual([
        {
          id: 'persistence',
          tone: 'error',
          text: 'titleBar.persistence.failed',
          detail: "Document 'd' does not exist",
          action: { kind: 'exportDocument', label: 'titleBar.persistence.export' },
        },
      ]);
    });

    it('without an error text there is no detail', () => {
      expect(titleBarNotices({ ...FINE, persistence: 'error' })[0]?.detail).toBeNull();
    });
  });

  describe('kernel', () => {
    it('starting: progress, so the empty view is explained', () => {
      expect(titleBarNotices({ ...FINE, kernel: 'starting' })).toEqual([
        {
          id: 'kernel',
          tone: 'progress',
          text: 'titleBar.kernel.starting',
          detail: null,
          action: null,
        },
      ]);
    });

    it('restarting: progress', () => {
      expect(titleBarNotices({ ...FINE, kernel: 'restarting' })).toEqual([
        {
          id: 'kernel',
          tone: 'progress',
          text: 'titleBar.kernel.restarting',
          detail: null,
          action: null,
        },
      ]);
    });

    it('failed: an alert with the cause and Try again', () => {
      expect(
        titleBarNotices({ ...FINE, kernel: 'failed', kernelError: 'RuntimeError: unreachable' }),
      ).toEqual([
        {
          id: 'kernel',
          tone: 'error',
          text: 'titleBar.kernel.failed',
          detail: 'RuntimeError: unreachable',
          action: { kind: 'retryKernel', label: 'titleBar.kernel.retry' },
        },
      ]);
    });

    it('unavailable: an alert with the cause and Try again', () => {
      expect(
        titleBarNotices({ ...FINE, kernel: 'unavailable', kernelError: 'WASM failed to load' }),
      ).toEqual([
        {
          id: 'kernel',
          tone: 'error',
          text: 'titleBar.kernel.unavailable',
          detail: 'WASM failed to load',
          action: { kind: 'retryKernel', label: 'titleBar.kernel.retry' },
        },
      ]);
    });

    it('a failed kernel without a cause has no detail', () => {
      expect(titleBarNotices({ ...FINE, kernel: 'failed' })[0]?.detail).toBeNull();
    });
  });

  it('a failed regeneration: an alert with the error as the detail', () => {
    expect(titleBarNotices({ ...FINE, regenFailed: 'TypeError: x is undefined' })).toEqual([
      {
        id: 'regen',
        tone: 'error',
        text: 'titleBar.regen.failed',
        detail: 'TypeError: x is undefined',
        action: null,
      },
    ]);
  });

  it('several at once in the order persistence, kernel, regeneration', () => {
    const notices = titleBarNotices({
      persistence: 'failed',
      persistenceError: 'gone',
      kernel: 'unavailable',
      kernelError: 'no WASM',
      regenFailed: 'bug',
    });
    expect(notices.map((n) => n.id)).toEqual(['persistence', 'kernel', 'regen']);
    expect(Object.isFrozen(notices)).toBe(true);
    for (const notice of notices) expect(Object.isFrozen(notice)).toBe(true);
  });

  it('every text and action label has a translation in cs and en', () => {
    const keys = new Set<string>();
    for (const persistence of ['saved', 'pending', 'error', 'failed'] as const) {
      for (const kernel of KERNEL_STATES) {
        const notices = titleBarNotices({
          persistence,
          persistenceError: 'e',
          kernel,
          kernelError: 'e',
          regenFailed: 'e',
        });
        for (const notice of notices) {
          keys.add(notice.text);
          if (notice.action !== null) keys.add(notice.action.label);
        }
      }
    }
    for (const key of [...keys, 'titleBar.details', 'file.exportedWithoutHistory']) {
      expect(cs[key], `cs ${key}`).toBeTypeOf('string');
      expect(en[key], `en ${key}`).toBeTypeOf('string');
    }
  });
});
