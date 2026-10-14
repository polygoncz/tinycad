import { describe, expect, it } from 'vitest';
import * as regen from '.';

// Guards the public API: a value export removed or added by accident shows up here.
describe('regen public API', () => {
  it('exports exactly the runtime values of spec 07', () => {
    expect(Object.keys(regen).sort()).toEqual([
      'EMPTY_NAMES',
      'EMPTY_STATE',
      'applyBodyOperation',
      'axesOf',
      'bodiesOf',
      'createBuilderRegistry',
      'createRegenerator',
      'planesOf',
      'propagateNames',
      'sketchesOf',
      'unresolvedReference',
    ]);
  });
});
