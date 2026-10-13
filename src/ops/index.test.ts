import { describe, expect, it } from 'vitest';
import * as ops from '.';

// Guards the public API: a value export removed or added by accident shows up here.
describe('ops public API', () => {
  it('exports exactly the runtime values of spec 04', () => {
    expect(Object.keys(ops).sort()).toEqual([
      'createOpHandlerRegistry',
      'createOperationDispatcher',
      'createOperationLog',
      'createUndoManager',
      'parseLogEntry',
      'rebuildUndoStacks',
      'replayLog',
      'upcastOperation',
    ]);
  });
});
