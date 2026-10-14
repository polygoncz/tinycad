import { describe, expect, it } from 'vitest';
import * as ops from '.';

// Guards the public API: a value export removed or added by accident shows up here.
describe('ops public API', () => {
  it('exports exactly the runtime values of spec 04', () => {
    expect(Object.keys(ops).sort()).toEqual([
      'OP_VERSION',
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

  it('OP_VERSION has the body metadata operations of M11 and M15', () => {
    expect(ops.OP_VERSION).toMatchObject({
      'body.rename': 1,
      'body.setVisible': 1,
      'body.setColor': 1,
    });
  });
});
