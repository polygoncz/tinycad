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
