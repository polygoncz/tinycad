import { describe, expect, it } from 'vitest';
import { OP_VERSION } from '@/ops';
import { BUILT_IN_OPERATION_TYPES } from './index';

describe('BUILT_IN_OPERATION_TYPES', () => {
  it('are the types of OP_VERSION, batch included, frozen', () => {
    expect([...BUILT_IN_OPERATION_TYPES].sort()).toEqual(Object.keys(OP_VERSION).sort());
    expect(BUILT_IN_OPERATION_TYPES).toContain('batch');
    expect(BUILT_IN_OPERATION_TYPES).toContain('body.setColor');
    expect(Object.isFrozen(BUILT_IN_OPERATION_TYPES)).toBe(true);
  });
});
