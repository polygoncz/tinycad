import { describe, expect, it } from 'vitest';
import * as pluginApi from '.';

// Guards the public API: a value export removed or added by accident shows up here.
describe('plugin-api public API', () => {
  it('exports exactly the runtime values of spec 11', () => {
    expect(Object.keys(pluginApi).sort()).toEqual(['registerPlugin']);
  });
});
