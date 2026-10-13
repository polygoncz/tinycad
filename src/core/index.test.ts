import { describe, expect, it } from 'vitest';
import * as core from '.';

// Guards the public API: a value export removed or added by accident shows up here.
describe('core public API', () => {
  it('exports exactly the runtime values of spec 02', () => {
    expect(Object.keys(core).sort()).toEqual(
      [
        'DisposableStore',
        'EPSILON',
        'Emitter',
        'ObservableValue',
        'RpcError',
        'assert',
        'assertNever',
        'createRandomIdGenerator',
        'createRegistry',
        'createRpcClient',
        'createSequentialIdGenerator',
        'err',
        'mat4',
        'ok',
        'serveRpc',
        'transfer',
        'vec3',
      ].sort(),
    );
  });
});
