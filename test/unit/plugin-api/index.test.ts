import { describe, expect, it } from 'vitest';
import * as pluginApi from '@/plugin-api';

// Guards the public API: a value export removed or added by accident shows up here.
describe('plugin-api public API', () => {
  it('exports no runtime values, only types (spec 11)', () => {
    expect(Object.keys(pluginApi)).toEqual([]);
  });
});
