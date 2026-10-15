import { describe, expect, it } from 'vitest';
import { createRandomIdGenerator, createSequentialIdGenerator, type RandomSource } from '@/core/id';

const BASE62 = /^[0-9A-Za-z]{10}$/;

// Deterministic source: repeats the given byte values.
function fixedSource(values: readonly number[]): RandomSource {
  let i = 0;
  return (bytes) => {
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] = values[i++ % values.length] ?? 0;
    }
  };
}

describe('createRandomIdGenerator', () => {
  it('produces 10 base62 characters', () => {
    const gen = createRandomIdGenerator(fixedSource([0, 61, 62, 123]));
    expect(gen.next()).toMatch(BASE62);
  });

  it('maps bytes to the alphabet 0-9A-Za-z', () => {
    const gen = createRandomIdGenerator(fixedSource([0, 9, 10, 35, 36, 61, 62, 123, 124, 247]));
    // 62 → 0, 123 → 61, 124 → 0, 247 → 61 (byte % 62)
    expect(gen.next()).toBe('09AZaz0z0z');
  });

  it('rejects bytes >= 248 to avoid modulo bias', () => {
    const gen = createRandomIdGenerator(fixedSource([248, 255, 1]));
    expect(gen.next()).toBe('1111111111');
  });

  it('fails loudly instead of looping forever on a broken source', () => {
    const gen = createRandomIdGenerator(fixedSource([255]));
    expect(() => gen.next()).toThrow('RandomSource');
  });

  it('is deterministic for a deterministic source', () => {
    const a = createRandomIdGenerator(fixedSource([5, 77, 200]));
    const b = createRandomIdGenerator(fixedSource([5, 77, 200]));
    expect(a.next()).toBe(b.next());
  });

  it('does not repeat with a real random source', () => {
    const gen = createRandomIdGenerator((bytes) => crypto.getRandomValues(bytes));
    const ids = new Set(Array.from({ length: 10_000 }, () => gen.next()));
    expect(ids.size).toBe(10_000);
    for (const id of ids) expect(id).toMatch(BASE62);
  });
});

describe('createSequentialIdGenerator', () => {
  it('counts from 1 with the default prefix', () => {
    const gen = createSequentialIdGenerator();
    expect([gen.next(), gen.next(), gen.next()]).toEqual(['id1', 'id2', 'id3']);
  });

  it('uses a custom prefix', () => {
    const gen = createSequentialIdGenerator('f');
    expect(gen.next()).toBe('f1');
  });

  it('keeps independent counters per generator', () => {
    const a = createSequentialIdGenerator();
    const b = createSequentialIdGenerator();
    a.next();
    expect(b.next()).toBe('id1');
  });
});
