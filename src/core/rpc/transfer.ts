// Marks a result whose buffers should be moved to the other side instead of
// copied (like std::move: the source buffer is detached afterwards).

const TRANSFER = Symbol('rpc.transfer');

export interface Transferred<T> {
  readonly [TRANSFER]: true;
  readonly value: T;
  readonly buffers: readonly ArrayBuffer[];
}

export function transfer<T>(value: T, buffers: readonly ArrayBuffer[]): Transferred<T> {
  return { [TRANSFER]: true, value, buffers };
}

export function isTransferred(x: unknown): x is Transferred<unknown> {
  return typeof x === 'object' && x !== null && TRANSFER in x;
}
