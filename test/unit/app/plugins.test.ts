import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FeaturePlugin } from '@/plugin-api';
import { featureSchemaOf } from '@/remote';
import { aFeatureTypeDescriptor } from '@/remote/testing';
import { BUILT_IN_PLUGINS } from '@/app/index';
import { createRemoteRegistries } from '@/app/remote-registries';

// The golden file of the feature types the C++ core describes (N75, N88).
const GOLDEN = join(import.meta.dirname, '../../golden/feature-types.json');

/** A descriptor of the golden file, read as plain JSON: only its type and labels matter here. */
interface GoldenType {
  readonly type: string;
  readonly [key: string]: unknown;
}

function goldenTypes(): readonly GoldenType[] {
  // The file is written by the C++ tests: { feature_types: [ FeatureTypeDescriptor as JSON ] }.
  const json = JSON.parse(readFileSync(GOLDEN, 'utf8')) as { feature_types: GoldenType[] };
  return json.feature_types;
}

/** Every `label` in a descriptor: the type, its params and the options of its enums. */
function labelsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(labelsOf);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) =>
    key === 'label' && typeof inner === 'string' ? [inner] : labelsOf(inner),
  );
}

const sorted = (types: readonly string[]): string[] => [...types].sort();

describe('BUILT_IN_PLUGINS', () => {
  it('is frozen and has the nine plugins in toolbar order', () => {
    expect(Object.isFrozen(BUILT_IN_PLUGINS)).toBe(true);
    expect(BUILT_IN_PLUGINS.map((p) => p.type)).toEqual([
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

  // N123: a feature type of the core without a client half, or a plugin without a type of the
  // core, fails here.
  it('has a plugin for every feature type of the core and no other', () => {
    expect(sorted(BUILT_IN_PLUGINS.map((p) => p.type))).toEqual(
      sorted(goldenTypes().map((t) => t.type)),
    );
  });

  it('registers together (no clashing tool or message key, unique shortcuts)', () => {
    // The params do not matter to the registries, only the types.
    const schemas = goldenTypes().map(({ type }) =>
      featureSchemaOf(aFeatureTypeDescriptor({ type })),
    );
    const registries = createRemoteRegistries(schemas, BUILT_IN_PLUGINS);
    const tools = registries.tools.all();
    for (const plugin of BUILT_IN_PLUGINS) {
      for (const tool of plugin.tools ?? []) expect(tools).toContain(tool);
    }
    const shortcuts = tools.flatMap((t) => (t.shortcut === undefined ? [] : [t.shortcut]));
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });

  // ADR 0014: every plugin checks its own dictionary; this checks all of them at once against the
  // labels of the core.
  it.each(goldenTypes().map((t) => [t.type, t] as const))(
    '%s has a cs and an en text for every label of the core and of its tools',
    (type, descriptor) => {
      const plugin: FeaturePlugin | undefined = BUILT_IN_PLUGINS.find((p) => p.type === type);
      if (plugin === undefined) expect.fail(`No plugin of '${type}'`);
      const keys = [...labelsOf(descriptor), ...(plugin.tools ?? []).map((t) => t.label)];
      expect(keys.length).toBeGreaterThan(0);
      const missing = (lang: 'cs' | 'en'): string[] =>
        keys.filter((key) => plugin.messages?.[lang][key] === undefined);
      expect(missing('cs')).toEqual([]);
      expect(missing('en')).toEqual([]);
    },
  );
});
