import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { DocumentId } from '@/document';
import { createMemoryDocumentStore } from '@/persistence';
import { createManualScheduler } from '@/persistence/testing';
import { BUILT_IN_PLUGINS, createAppSession } from './index';
import { aKernelFactory, FakeAppViewport } from './testing';

describe('BUILT_IN_PLUGINS', () => {
  it('is frozen and has the box', () => {
    expect(Object.isFrozen(BUILT_IN_PLUGINS)).toBe(true);
    expect(BUILT_IN_PLUGINS.map((p) => p.schema.type)).toContain('box');
  });

  it('opens a session together (complete registries, no clashing keys)', async () => {
    const session = await createAppSession({
      plugins: BUILT_IN_PLUGINS,
      store: createMemoryDocumentStore({ now: () => 0 }),
      docId: 'doc1' as DocumentId, // test value
      createKernel: aKernelFactory().create,
      viewport: new FakeAppViewport(),
      scheduler: createManualScheduler(),
      now: () => 0,
      ids: createSequentialIdGenerator('f'),
      translate: (key) => key,
      readOnly: false,
    });
    expect(session.toolList.map((t) => t.id)).toContain('box');
    session.dispose();
  });
});
