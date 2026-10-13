// The feature dialog end to end (M9): a box plugin, a document with operations, the
// Regenerator over FakeKernel and the FeatureEditor. Checks that the open session already
// regenerates (live preview) and that OK writes one log entry while Cancel leaves no body.

import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import { createDocument, createFeatureSchemaRegistry } from '@/document';
import type { DocumentId } from '@/document';
import { boxPlugin } from '@/features/box';
import { createFeatureEditor, createToolRegistry } from '@/interaction';
import { createFakeKernel } from '@/kernel/testing';
import { createOpHandlerRegistry, createOperationDispatcher, createOperationLog } from '@/ops';
import { registerPlugin } from '@/plugin-api';
import { createBuilderRegistry, createRegenerator } from '@/regen';

function setup() {
  const kernel = createFakeKernel();
  const schemas = createFeatureSchemaRegistry();
  const builders = createBuilderRegistry();
  registerPlugin(boxPlugin, { schemas, builders, tools: createToolRegistry() });
  const doc = createDocument({
    meta: { id: 'dialog' as DocumentId, name: 'Dialog', createdAt: 0 }, // a test id is trusted
  });
  const log = createOperationLog();
  const ops = createOperationDispatcher({ doc, handlers: createOpHandlerRegistry(), log });
  const regenerator = createRegenerator({ kernel, schemas, builders, now: () => 0 });
  const editor = createFeatureEditor({
    doc,
    ops,
    schemas,
    ids: createSequentialIdGenerator('f'),
    // The English texts of the plugin, as ui would translate them (ADR 0014).
    translate: (key) => boxPlugin.messages?.en[key] ?? key,
  });

  /** Regenerates the current document; per body its creator and bounding box. */
  async function regenerate() {
    const result = await regenerator.run(doc.studio);
    if (result === 'superseded') expect.fail('Unexpected superseded run');
    return Promise.all(
      [...result.finalState.bodies.values()].map(async (body) => ({
        createdBy: body.createdBy,
        box: await kernel.boundingBox(body.shape),
      })),
    );
  }

  return { kernel, doc, log, editor, regenerate };
}

describe('feature dialog with the box plugin', () => {
  it('previews the box live and commits one log entry', async () => {
    const { doc, log, editor, regenerate } = setup();

    const session = editor.create('box');
    expect(await regenerate()).toEqual([
      { createdBy: session.featureId, box: { min: [0, 0, 0], max: [10, 10, 10] } },
    ]);

    session.setParam('height', 25);
    expect(await regenerate()).toEqual([
      { createdBy: session.featureId, box: { min: [0, 0, 0], max: [10, 10, 25] } },
    ]);
    expect(log.entries()).toEqual([]);

    session.commit();
    expect(log.entries()).toHaveLength(1);
    expect(doc.studio.features.map((f) => f.name)).toEqual(['Box 1']);
    expect(await regenerate()).toEqual([
      { createdBy: session.featureId, box: { min: [0, 0, 0], max: [10, 10, 25] } },
    ]);
  });

  it('leaves no body and no log entry after cancel', async () => {
    const { kernel, doc, log, editor, regenerate } = setup();

    const session = editor.create('box');
    session.setParam('height', 25);
    expect(await regenerate()).toHaveLength(1);

    session.cancel();
    expect(doc.studio.features).toEqual([]);
    expect(log.entries()).toEqual([]);
    expect(await regenerate()).toEqual([]);
    expect(await kernel.liveHandleCount()).toBe(0);
  });
});
