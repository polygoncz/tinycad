import { createRegistry } from '@/core';
import type { RegistryReader } from '@/core';
import type { FeatureSchema } from '@/document';
import { createFeatureHandlers } from './handlers/feature';
import { studioHandlers } from './handlers/studio';
import type { OpHandler, OpHandlerRegistry } from './op-handler';

export type { OpHandler, OpHandlerRegistry } from './op-handler';

/**
 * Registry with the built-in handlers. register({ type: 'batch' }) throws. The schemas are for
 * migrating the feature data of operations when applied (Q035).
 */
export function createOpHandlerRegistry(deps: {
  schemas: RegistryReader<FeatureSchema>;
}): OpHandlerRegistry {
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
  for (const handler of [...createFeatureHandlers(deps.schemas), ...studioHandlers]) {
    guarded.register(handler);
  }
  return guarded;
}
