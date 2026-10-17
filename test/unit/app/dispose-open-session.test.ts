import { describe, expect, it } from 'vitest';
import { disposeOpenSession } from '@/app/dispose-open-session';
import { settle } from '@/app/testing';

/** A session part whose flush the test settles by hand; calls are recorded in `log`. */
function aSession(log: string[]) {
  let settleFlush: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  return {
    session: {
      dispose: () => {
        log.push('session.dispose');
      },
      flush: () => {
        log.push('session.flush');
        return new Promise<void>((resolve, reject) => {
          settleFlush = { resolve, reject };
        });
      },
    },
    resolveFlush: () => {
      settleFlush?.resolve();
    },
    rejectFlush: (e: unknown) => {
      settleFlush?.reject(e);
    },
  };
}

function setup() {
  const log: string[] = [];
  const errors: unknown[] = [];
  const fake = aSession(log);
  disposeOpenSession({
    session: fake.session,
    viewport: {
      dispose: () => {
        log.push('viewport.dispose');
      },
    },
    afterFlush: {
      dispose: () => {
        log.push('storage.dispose');
      },
    },
    onError: (e) => errors.push(e),
  });
  return { log, errors, ...fake };
}

describe('disposeOpenSession', () => {
  it('releases the session and the viewport at once, the storage only after the flush', async () => {
    const { log, resolveFlush } = setup();
    expect(log).toEqual(['session.dispose', 'viewport.dispose', 'session.flush']);
    await settle();
    expect(log).not.toContain('storage.dispose');
    resolveFlush();
    await settle();
    expect(log.at(-1)).toBe('storage.dispose');
  });

  it('releases the storage also when the flush fails, and reports the error', async () => {
    const { log, errors, rejectFlush } = setup();
    const failure = new Error('write failed');
    rejectFlush(failure);
    await settle();
    expect(log.at(-1)).toBe('storage.dispose');
    expect(errors).toEqual([failure]);
  });
});
