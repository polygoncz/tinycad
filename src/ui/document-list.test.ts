import { describe, expect, it } from 'vitest';
import type { DocumentInfo } from '@/app';
import type { DocumentId } from '@/document';
import { loadDocumentList, updatedFormatter } from './document-list';

function anInfo(id: string, updatedAt: number): DocumentInfo {
  // Test ids are trusted.
  return { meta: { id: id as DocumentId, name: id, createdAt: 0 }, lastSeq: 0, updatedAt };
}

describe('loadDocumentList', () => {
  it('a list → loaded with that list', async () => {
    const documents = [anInfo('a', 1), anInfo('b', 2)];
    await expect(loadDocumentList(() => Promise.resolve(documents))).resolves.toEqual({
      kind: 'loaded',
      documents,
    });
  });

  it('an empty list is loaded too', async () => {
    await expect(loadDocumentList(() => Promise.resolve([]))).resolves.toEqual({
      kind: 'loaded',
      documents: [],
    });
  });

  it('a rejection → failed with its message, never a rejection (no endless "Loading…")', async () => {
    await expect(
      loadDocumentList(() => Promise.reject(new Error('IndexedDB is blocked'))),
    ).resolves.toEqual({ kind: 'failed', error: 'IndexedDB is blocked' });
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a reason that is not an Error, as IndexedDB code may give
    const notAnError = () => Promise.reject('private mode');
    await expect(loadDocumentList(notAnError)).resolves.toEqual({
      kind: 'failed',
      error: 'private mode',
    });
  });

  it('a list function that throws → failed', async () => {
    const state = await loadDocumentList(() => {
      throw new Error('no IndexedDB');
    });
    expect(state).toEqual({ kind: 'failed', error: 'no IndexedDB' });
  });

  it('is frozen', async () => {
    expect(Object.isFrozen(await loadDocumentList(() => Promise.resolve([])))).toBe(true);
  });
});

describe('updatedFormatter', () => {
  const MARCH = Date.UTC(2026, 2, 14, 9, 30);

  it('formats the time of the last change by the locale, date and time', () => {
    const options = { dateStyle: 'medium', timeStyle: 'short' } as const;
    expect(updatedFormatter('cs')(MARCH)).toBe(
      new Intl.DateTimeFormat('cs', options).format(MARCH),
    );
    expect(updatedFormatter('en')(MARCH)).toBe(
      new Intl.DateTimeFormat('en', options).format(MARCH),
    );
  });

  it('one formatter serves the whole list', () => {
    const format = updatedFormatter('en');
    const later = MARCH + 86_400_000;
    expect([format(MARCH), format(later)]).toEqual([
      new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(MARCH),
      new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(later),
    ]);
  });
});
