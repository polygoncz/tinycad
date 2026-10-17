import { describe, expect, it } from 'vitest';
import { OP_VERSION } from '@/ops/operation';

describe('OP_VERSION', () => {
  it('has an integer version >= 1 for every operation type (spec 04)', () => {
    for (const v of Object.values(OP_VERSION)) {
      expect(Number.isInteger(v) && v >= 1).toBe(true);
    }
  });
});
