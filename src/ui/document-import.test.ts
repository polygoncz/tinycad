import { describe, expect, it } from 'vitest';
import { err, ok } from '@/core';
import type { Result } from '@/core';
import type { DocumentId, DocumentLoadError } from '@/document';
import { importDocumentText } from './document-import';

// DocumentId is a branded string; ui may not import the parser of document.
const ID = 'doc-1' as DocumentId;

type ImportFile = (raw: unknown) => Promise<Result<DocumentId, DocumentLoadError>>;

describe('importDocumentText', () => {
  it('parses the text and returns the id of the new document', async () => {
    const seen: unknown[] = [];
    const importFile: ImportFile = (raw) => {
      seen.push(raw);
      return Promise.resolve(ok(ID));
    };
    expect(await importDocumentText('{"format":"tinycad.file"}', importFile)).toEqual({
      ok: true,
      id: ID,
    });
    expect(seen).toEqual([{ format: 'tinycad.file' }]);
  });

  it('a text that is not JSON is an error without calling import', async () => {
    let called = false;
    const importFile: ImportFile = () => {
      called = true;
      return Promise.resolve(ok(ID));
    };
    const outcome = await importDocumentText('not json', importFile);
    expect(outcome.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('a refused file gives its first issue as the detail', async () => {
    const importFile: ImportFile = () =>
      Promise.resolve(
        err({
          issues: [
            { path: 'formatVersion', message: 'Unsupported version' },
            { path: 'snapshot', message: 'Other' },
          ],
        }),
      );
    expect(await importDocumentText('{}', importFile)).toEqual({
      ok: false,
      detail: 'formatVersion: Unsupported version',
    });
  });

  it('a refusal without issues has no detail', async () => {
    const importFile: ImportFile = () => Promise.resolve(err({ issues: [] }));
    expect(await importDocumentText('{}', importFile)).toEqual({ ok: false, detail: null });
  });
});
