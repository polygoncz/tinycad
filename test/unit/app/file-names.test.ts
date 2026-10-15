import { describe, expect, it } from 'vitest';
import { safeFileName } from '@/app/file-names';

describe('safeFileName', () => {
  it('keeps an ordinary name, with spaces and diacritics', () => {
    expect(safeFileName('Držák motoru v2')).toBe('Držák motoru v2');
  });

  it('replaces the characters forbidden in file names with _', () => {
    expect(safeFileName('a\\b/c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('replaces control characters with _', () => {
    expect(safeFileName('a\u0000b\tc\nd\u007fe')).toBe('a_b_c_d_e');
  });

  it('trims spaces and dots at both ends', () => {
    expect(safeFileName('  .díl.  ')).toBe('díl');
    expect(safeFileName('díl...')).toBe('díl');
  });

  it('an empty name, or one of only spaces and dots, becomes tinycad', () => {
    expect(safeFileName('')).toBe('tinycad');
    expect(safeFileName(' . . ')).toBe('tinycad');
  });

  it('cuts a long name to 100 characters, trimming what the cut leaves at the end', () => {
    expect(safeFileName('x'.repeat(150))).toBe('x'.repeat(100));
    expect(safeFileName(`${'x'.repeat(98)}. y`)).toBe('x'.repeat(98));
  });
});
