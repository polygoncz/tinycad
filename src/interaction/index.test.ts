import { describe, expect, it } from 'vitest';
import * as interaction from '.';

// Guards the public API: a value export removed or added by accident shows up here.
describe('interaction public API', () => {
  it('exports no runtime values yet, only the viewport port types', () => {
    expect(Object.keys(interaction)).toEqual([]);
  });
});
