import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import { createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { FeatureSchema } from '@/document';
import type { ParamSchemaOf } from '@/document/testing';
import { aFakeOps } from '@/ops/testing';
import { createEditLock } from '@/interaction/edit-lock';
import { createFeatureEditor } from '@/interaction/feature-dialog/feature-editor';

const BOX_PARAMS: ParamSchemaOf<{ readonly width: number }> = {
  width: { kind: 'length', label: 'box.width', default: 10, min: 0 },
};

const BOX: FeatureSchema<{ readonly width: number }> = {
  type: 'box',
  version: 1,
  label: 'box.label',
  params: BOX_PARAMS,
  defaults: () => ({ width: 10 }),
  validate: (params) => validateAgainstSchema(BOX_PARAMS, params),
};

function setup() {
  const session = aFakeOps();
  const schemas = createFeatureSchemaRegistry();
  schemas.register(BOX);
  const editor = createFeatureEditor({
    doc: session.doc,
    ops: session,
    schemas,
    ids: createSequentialIdGenerator('new'),
  });
  return { editor };
}

describe('createEditLock', () => {
  it('is locked while a feature edit session is open', () => {
    const { editor } = setup();
    const locked = createEditLock({ readOnly: false, editor });
    let emits = 0;
    locked.subscribe(() => {
      emits++;
    });
    expect(locked.get()).toBe(false);

    const edit = editor.create('box');
    expect(locked.get()).toBe(true);
    expect(emits).toBe(1);

    edit.cancel();
    expect(locked.get()).toBe(false);
    expect(emits).toBe(2);
  });

  it('is always locked read-only and never notifies', () => {
    const { editor } = setup();
    const locked = createEditLock({ readOnly: true, editor });
    let emits = 0;
    locked.subscribe(() => {
      emits++;
    });
    expect(locked.get()).toBe(true);
    editor.create('box').cancel();
    expect(locked.get()).toBe(true);
    expect(emits).toBe(0);
  });

  it('unsubscribe stops the notifications', () => {
    const { editor } = setup();
    const locked = createEditLock({ readOnly: false, editor });
    let emits = 0;
    const off = locked.subscribe(() => {
      emits++;
    });
    off();
    editor.create('box');
    expect(emits).toBe(0);
    expect(locked.get()).toBe(true);
  });

  it('is a read-only view without set', () => {
    const { editor } = setup();
    const locked = createEditLock({ readOnly: false, editor });
    expect('set' in locked).toBe(false);
    expect(Object.isFrozen(locked)).toBe(true);
  });
});
