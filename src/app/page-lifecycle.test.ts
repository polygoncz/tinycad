import { describe, expect, it } from 'vitest';
import { flushOnPageHide } from './page-lifecycle';

/** A fake document: an event target whose visibilityState the test sets. */
class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

function setup(flush: () => Promise<void> = () => Promise.resolve()) {
  const page = new EventTarget();
  const doc = new FakeDocument();
  const calls: string[] = [];
  const errors: unknown[] = [];
  const binding = flushOnPageHide({
    page,
    document: doc,
    flush: () => {
      calls.push('flush');
      return flush();
    },
    onError: (e) => errors.push(e),
  });
  return { page, doc, calls, errors, binding };
}

describe('flushOnPageHide', () => {
  it('flushes on pagehide', () => {
    const { page, calls } = setup();
    page.dispatchEvent(new Event('pagehide'));
    expect(calls).toEqual(['flush']);
  });

  it('flushes when the page becomes hidden', () => {
    const { doc, calls } = setup();
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toEqual(['flush']);
  });

  it('does not flush when the page becomes visible again', () => {
    const { doc, calls } = setup();
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toEqual([]);
  });

  it('reports a failed flush instead of rejecting unobserved', async () => {
    const failure = new Error('disk full');
    const { page, errors } = setup(() => Promise.reject(failure));
    page.dispatchEvent(new Event('pagehide'));
    await Promise.resolve();
    expect(errors).toEqual([failure]);
  });

  it('stops listening on dispose', () => {
    const { page, doc, calls, binding } = setup();
    binding.dispose();
    binding.dispose();
    page.dispatchEvent(new Event('pagehide'));
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toEqual([]);
  });
});
