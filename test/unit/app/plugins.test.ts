import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import type { DocumentId } from '@/document';
import { createMemoryDocumentStore } from '@/persistence';
import type { FeaturePlugin } from '@/plugin-api';
import { createManualScheduler } from '@/persistence/testing';
import { createFakeSolver } from '@/sketch/testing';
import { BUILT_IN_PLUGINS, createAppSession } from '@/app/index';
import { aKernelFactory, FakeAppViewport } from '@/app/testing';

describe('BUILT_IN_PLUGINS', () => {
  it('is frozen and has the nine plugins in toolbar order', () => {
    expect(Object.isFrozen(BUILT_IN_PLUGINS)).toBe(true);
    expect(BUILT_IN_PLUGINS.map((p) => p.schema.type)).toEqual([
      'box',
      'cylinder',
      'transform',
      'boolean',
      'sketch',
      'extrude',
      'revolve',
      'fillet',
      'chamfer',
    ]);
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
      monotonic: () => 0,
      ids: createSequentialIdGenerator('f'),
      translate: (key) => key,
      confirm: () => true,
      readOnly: false,
      solver: createFakeSolver(),
      download: () => undefined,
      theme: 'light',
    });
    const items = () => session.toolbar.groups.get().flatMap((g) => g.items);
    const model = items();
    expect(model.map((i) => i.id)).toEqual(
      expect.arrayContaining([
        'box',
        'cylinder',
        'transform',
        'boolean',
        'sketch',
        'extrude',
        'revolve',
        'fillet',
        'chamfer',
      ]),
    );
    const sketch = model.find((i) => i.id === 'sketch');
    if (sketch === undefined) expect.fail('No sketch tool');
    session.toolbar.run(sketch);
    expect(session.mode.get()).toBe('sketch');
    // No two buttons of one mode share a shortcut (tools of disjoint modes may: C is the cylinder
    // in the model and the circle in the sketch, spec 10 "Režim").
    for (const shown of [model, items()]) {
      const shortcuts = shown.flatMap((i) => (i.shortcut === null ? [] : [i.shortcut]));
      expect(new Set(shortcuts).size).toBe(shortcuts.length);
    }
    session.dispose();
  });

  // ADR 0014: every plugin checks its own dictionary; this checks all of them at once.
  it.each(BUILT_IN_PLUGINS.map((p) => [p.schema.type, p] as const))(
    '%s has a cs and an en text for every label',
    (_type, plugin) => {
      const keys = labelKeys(plugin);
      expect(keys.length).toBeGreaterThan(0);
      const missing = (lang: 'cs' | 'en'): string[] =>
        keys.filter((key) => plugin.messages?.[lang][key] === undefined);
      expect(missing('cs')).toEqual([]);
      expect(missing('en')).toEqual([]);
    },
  );
});

/** Label keys of the schema, its params, their enum options and the tools. */
function labelKeys(plugin: FeaturePlugin): string[] {
  const params = Object.values(plugin.schema.params).flatMap((spec) => [
    spec.label,
    ...(spec.kind === 'enum' ? spec.options.map((o) => o.label) : []),
  ]);
  const tools = (plugin.tools ?? []).map((t) => t.label);
  return [plugin.schema.label, ...params, ...tools];
}
