import type { GeometryKernel } from '@/kernel';

/** What the worker serves: the kernel, plus waiting for the OCCT initialisation. */
interface OcctWorkerApi extends GeometryKernel {
  /** Resolves once OCCT is initialised; rejects with 'internal' if the initialisation failed. */
  ready(): Promise<void>;
}

/**
 * RPC protocol of the OCCT worker (spec 06, "Start workeru a ready"): one entry per
 * GeometryKernel method with the same arguments and result – derived from the port, so the two
 * cannot drift apart – plus `ready(): void`.
 */
export type OcctKernelProtocol = {
  readonly [K in keyof OcctWorkerApi]: {
    readonly args: Parameters<OcctWorkerApi[K]>;
    readonly result: Awaited<ReturnType<OcctWorkerApi[K]>>;
  };
};

/**
 * Notification the worker sends on its own, outside the request/response pairs, when the WASM
 * traps (spec 06, Chyby; Q055): the kernel is dead. It has no `id`, so the RPC client ignores
 * it; the owner of the worker listens for it, fails all calls and terminates the worker.
 */
export interface OcctFatalNotice {
  readonly type: 'fatal';
  /** The message of the WebAssembly.RuntimeError. */
  readonly message: string;
}

/** Messages arrive as unknown; this guard replaces a cast. */
export function isOcctFatalNotice(x: unknown): x is OcctFatalNotice {
  return (
    typeof x === 'object' &&
    x !== null &&
    'type' in x &&
    x.type === 'fatal' &&
    'message' in x &&
    typeof x.message === 'string'
  );
}
