import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from '@/core/result';

function parsePositive(s: string): Result<number, string> {
  const n = Number(s);
  return n > 0 ? ok(n) : err(`not a positive number: ${s}`);
}

describe('Result', () => {
  it('ok carries a value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('err carries an error', () => {
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
  });

  it('narrows on the ok discriminant', () => {
    const r = parsePositive('3');
    if (!r.ok) throw new Error('expected ok');
    // r.value is typed as number here; r.error would not compile.
    expect(r.value + 1).toBe(4);
  });

  it('reports expected failures without throwing', () => {
    const r = parsePositive('-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('not a positive number: -1');
  });
});
