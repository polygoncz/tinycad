import { describe, expect, it } from 'vitest';
import type { DocumentId } from '@/document';
import { acquireDocumentLock, documentLockName } from './doc-lock';
import type { DocumentLocks } from './doc-lock';
import { aFakeLocks, settle } from './testing';

// Branded ids are created by a cast at one place in tests.
const DOC = 'doc1' as DocumentId;

describe('acquireDocumentLock', () => {
  it('names the lock after the document', () => {
    expect(documentLockName(DOC)).toBe('tinycad-doc-doc1');
  });

  it('gets a free lock and asks without waiting', async () => {
    const { locks, held, requests } = aFakeLocks();
    const lock = await acquireDocumentLock(locks, DOC);
    expect(lock.held).toBe(true);
    expect(held.has('tinycad-doc-doc1')).toBe(true);
    expect(requests).toEqual([{ name: 'tinycad-doc-doc1', ifAvailable: true }]);
  });

  it('does not get a lock held by another tab (read-only)', async () => {
    const { locks } = aFakeLocks();
    const first = await acquireDocumentLock(locks, DOC);
    const second = await acquireDocumentLock(locks, DOC);
    expect(first.held).toBe(true);
    expect(second.held).toBe(false);
    second.dispose();
  });

  it('holds the lock until dispose, which releases it once', async () => {
    const { locks, held } = aFakeLocks();
    const lock = await acquireDocumentLock(locks, DOC);
    await settle();
    expect(held.size).toBe(1);
    lock.dispose();
    lock.dispose();
    await settle();
    expect(held.size).toBe(0);
    expect((await acquireDocumentLock(locks, DOC)).held).toBe(true);
  });

  it('rejects when the lock manager refuses the request', async () => {
    const locks: DocumentLocks = {
      request: () => Promise.reject(new Error('SecurityError')),
    };
    await expect(acquireDocumentLock(locks, DOC)).rejects.toThrow('SecurityError');
  });
});
