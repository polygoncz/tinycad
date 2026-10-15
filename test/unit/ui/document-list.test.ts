import { describe, expect, it } from 'vitest';
import { updatedFormatter } from '@/ui/document-list';

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
