import { describe, expect, it } from 'vitest';
import { finishEdit } from '@/ui/inline-rename';

describe('finishEdit', () => {
  it('ends a running edit once and returns its key', () => {
    const editing: { value: string | null } = { value: 'doc-1' };
    expect(finishEdit(editing)).toBe('doc-1');
    expect(editing.value).toBeNull();
    // The blur that follows Enter (the field goes away) finds no edit.
    expect(finishEdit(editing)).toBeNull();
  });

  it('returns null without an edit', () => {
    expect(finishEdit({ value: null })).toBeNull();
  });
});
