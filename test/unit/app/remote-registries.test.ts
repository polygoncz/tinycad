import { afterEach, describe, expect, it, vi } from 'vitest';
import { boxPlugin } from '@/features/box';
import { cylinderPlugin } from '@/features/cylinder';
import { extrudePlugin } from '@/features/extrude';
import { featureSchemaOf } from '@/remote';
import { aFeatureTypeDescriptor } from '@/remote/testing';
import { createRemoteRegistries } from '@/app/remote-registries';

/** A schema of the server for `type` (its params do not matter to the registries). */
const serverType = (type: string) => featureSchemaOf(aFeatureTypeDescriptor({ type }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createRemoteRegistries', () => {
  it('takes the schemas from the server, not from the plugins', () => {
    const box = serverType('box');
    const registries = createRemoteRegistries([box, serverType('thing')], [boxPlugin]);
    expect(registries.schemas.get('box')).toBe(box);
    expect(registries.schemas.all().map((s) => s.type)).toEqual(['box', 'thing']);
  });

  it('gives a type without a client half a schema but no tool', () => {
    const registries = createRemoteRegistries([serverType('thing')], []);
    expect(registries.schemas.has('thing')).toBe(true);
    expect(registries.tools.all().map((t) => t.id)).toEqual(['select']);
    expect(registries.manipulators.all()).toEqual([]);
  });

  it('registers the tools and manipulators of the known plugins after the select tool', () => {
    const registries = createRemoteRegistries(
      [serverType('box'), serverType('extrude')],
      [boxPlugin, extrudePlugin],
    );
    const ids = registries.tools.all().map((t) => t.id);
    expect(ids[0]).toBe('select');
    for (const tool of [...(boxPlugin.tools ?? []), ...(extrudePlugin.tools ?? [])]) {
      expect(ids).toContain(tool.id);
    }
    expect(registries.manipulators.has('extrude')).toBe(true);
  });

  it('skips a plugin of a type the server does not know, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const registries = createRemoteRegistries([serverType('box')], [boxPlugin, cylinderPlugin]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'cylinder'"));
    expect(registries.schemas.has('cylinder')).toBe(false);
    for (const tool of cylinderPlugin.tools ?? []) {
      expect(registries.tools.has(tool.id)).toBe(false);
    }
    for (const key of Object.keys(cylinderPlugin.messages?.en ?? {})) {
      expect(Object.hasOwn(registries.messages.en, key)).toBe(false);
    }
  });

  it('merges the messages of the known plugins', () => {
    const registries = createRemoteRegistries(
      [serverType('box'), serverType('extrude')],
      [boxPlugin, extrudePlugin],
    );
    expect(registries.messages.cs).toEqual({
      ...boxPlugin.messages?.cs,
      ...extrudePlugin.messages?.cs,
    });
    expect(registries.messages.en).toEqual({
      ...boxPlugin.messages?.en,
      ...extrudePlugin.messages?.en,
    });
  });

  it('builds the handlers of the operations over the schemas of the server', () => {
    const registries = createRemoteRegistries([serverType('box')], [boxPlugin]);
    expect(registries.handlers.get('feature.add')).toBeDefined();
  });
});
