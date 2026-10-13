import { assert } from './assert';

// Id format decided in Q002: 10 random base62 characters.
// Ids are generated before an operation is created, never inside apply (determinism).

export interface IdGenerator {
  next(): string;
}

/** Fills the array with random bytes. The app passes crypto.getRandomValues (Q022). */
export type RandomSource = (bytes: Uint8Array<ArrayBuffer>) => void;

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ID_LENGTH = 10;
// Largest multiple of 62 that fits in a byte. Bytes at or above it are rejected,
// otherwise byte % 62 would favour the first 256 - 248 = 8 characters.
const BYTE_LIMIT = 248;
const MAX_REFILLS = 100;

export function createRandomIdGenerator(random: RandomSource): IdGenerator {
  const bytes = new Uint8Array(16);
  return {
    next() {
      let id = '';
      for (let refills = 0; id.length < ID_LENGTH; refills++) {
        // A healthy source rejects ~3 % of bytes; this guards against a broken test double.
        assert(refills < MAX_REFILLS, 'RandomSource keeps returning unusable bytes');
        random(bytes);
        for (const b of bytes) {
          if (b >= BYTE_LIMIT) continue;
          id += ALPHABET.charAt(b % ALPHABET.length);
          if (id.length === ID_LENGTH) break;
        }
      }
      return id;
    },
  };
}

/** Predictable ids for tests: 'id1', 'id2', … */
export function createSequentialIdGenerator(prefix = 'id'): IdGenerator {
  let n = 0;
  return { next: () => `${prefix}${String(++n)}` };
}
