// Ring 1 – ids, events, Result, Disposable, math, worker RPC. Imports nothing.
// Public API of core (spec 02-core). Everything else in this folder is internal.

export type { Brand } from './brand';
export { createRandomIdGenerator, createSequentialIdGenerator } from './id';
export type { IdGenerator, RandomSource } from './id';

export { Emitter } from './emitter';
export type { EventMap, Subscribable } from './emitter';
export { ObservableValue } from './observable';
export type { Observable } from './observable';
export { DisposableStore } from './disposable';
export type { Disposable, Unsubscribe } from './disposable';
export { createRegistry } from './registry';
export type { Registry, RegistryOptions, RegistryReader } from './registry';

export { err, ok } from './result';
export type { Result } from './result';
export { assert, assertNever } from './assert';

export { EPSILON, vec3 } from './math/vec3';
export type { Vec3 } from './math/vec3';
export { mat4 } from './math/mat4';
export type { Mat4 } from './math/mat4';
export { plane } from './math/plane';
export type { Plane, Vec2 } from './math/plane';

export { createRpcClient } from './rpc/client';
export type { RpcClient } from './rpc/client';
export { serveRpc } from './rpc/server';
export type { RpcImpl } from './rpc/server';
export { RpcError } from './rpc/error';
export { transfer } from './rpc/transfer';
export type { Transferred } from './rpc/transfer';
export type { MessageEndpoint, RpcProtocol } from './rpc/messages';
