import { describe, expect, it } from 'vitest';
import type { DocumentId } from '@/document';
import { docHash, parseDocHash } from './route';

describe('parseDocHash', () => {
  it('reads the document id from #/d/<id>', () => {
    expect(parseDocHash('#/d/abc123')).toBe('abc123');
  });

  it('decodes an escaped id', () => {
    expect(parseDocHash('#/d/a%20b')).toBe('a b');
  });

  it.each(['', '#', '#/', '#/d/', '#/x/abc', '#d/abc', '#/d/abc/def', '#/d/%E0%A4%A'])(
    '%j is the document list (null)',
    (hash) => {
      expect(parseDocHash(hash)).toBeNull();
    },
  );
});

describe('docHash', () => {
  it('is the inverse of parseDocHash', () => {
    const id = 'a b/c' as DocumentId; // test value, the brand does not matter here
    expect(parseDocHash(docHash(id))).toBe(id);
    expect(docHash('abc' as DocumentId)).toBe('#/d/abc'); // test value
  });
});
