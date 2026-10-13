import { createRegistry } from '@/core';
import { featureHandlers } from './handlers/feature';
import { studioHandlers } from './handlers/studio';
import type { OpHandler, OpHandlerRegistry } from './op-handler';

export type { OpHandler, OpHandlerRegistry } from './op-handler';

/** Registry with the built-in handlers. register({ type: 'batch' }) throws. */
export function createOpHandlerRegistry(): OpHandlerRegistry {
  const registry = createRegistry<OpHandler>({ what: 'op handler', keyOf: (h) => h.type });
  const guarded: OpHandlerRegistry = {
    ...registry,
    register(handler) {
      if (handler.type === 'batch') {
        throw new Error("'batch' is a structural operation and cannot have a handler");
      }
      registry.register(handler);
    },
  };
  for (const handler of [...featureHandlers, ...studioHandlers]) guarded.register(handler);
  return guarded;
}
