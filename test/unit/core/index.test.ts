import { describe, expect, it } from 'vitest';
import * as core from '@/core';

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
        'TWO_PI',
        'assert',
        'assertNever',
        'bspline',
        'createRandomIdGenerator',
        'createRegistry',
        'createRpcClient',
        'createSequentialIdGenerator',
        'err',
        'mat4',
        'mod2pi',
        'ok',
        'plane',
        'quat',
        'serveRpc',
        'transfer',
        'vec2',
        'vec3',
      ].sort(),
    );
  });
});
