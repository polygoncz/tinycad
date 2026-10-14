import { describe, expect, it } from 'vitest';
import { createSequentialIdGenerator, ObservableValue } from '@/core';
import { createFeatureSchemaRegistry, validateAgainstSchema } from '@/document';
import type { BodyId, FeatureId, FeatureSchema, ParamSchema } from '@/document';
import { anOpsSession } from '@/ops/testing';
import { createActionRegistry } from './actions';
import { createFeatureEditor } from './feature-editor';
import { FILE_ACTION_IDS, createFileActions } from './file-actions';
import type { Mode } from './mode';
import { FakeFileExporter, FakeRegenStatus } from './testing';

const BOX_PARAMS: ParamSchema = {
  width: { kind: 'length', label: 'box.width', default: 10, min: 0 },
};

const BOX: FeatureSchema = {
  type: 'box',
  version: 1,
  label: 'box.label',
  params: BOX_PARAMS,
  defaults: () => ({ width: 10 }),
  validate: (params) => validateAgainstSchema(BOX_PARAMS, params),
};

const fid = (id: string): FeatureId => id as FeatureId; // test ids are trusted
const bid = (id: string): BodyId => id as BodyId; // test ids are trusted

const A = bid('a/body');
/** Idle without a warning: the state before any export and after a full one. */
const IDLE = { kind: 'idle', warning: null };
const B = bid('b/body');
const C = bid('c/body');

/** Settles pending promise callbacks. */
const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

function setup() {
  const { doc, dispatcher } = anOpsSession();
  const schemas = createFeatureSchemaRegistry();
  schemas.register(BOX);
  const editor = createFeatureEditor({
    doc,
    ops: dispatcher,
    schemas,
    ids: createSequentialIdGenerator('f'),
  });
  const mode = new ObservableValue<Mode>('model');
  const registry = createActionRegistry({ mode: mode.asObservable() });
  const regen = new FakeRegenStatus();
  const hidden = new ObservableValue<ReadonlySet<BodyId>>(new Set());
  const exporter = new FakeFileExporter();
  const actions = createFileActions({
    registry,
    exporter,
    regen,
    browser: { hidden: hidden.asObservable() },
    editor,
    mode: mode.asObservable(),
  });
  const state = (id: string) => {
    const found = registry.actions.get().find((a) => a.id === id);
    if (found === undefined) throw new Error(`No action '${id}'`);
    return found;
  };
  const publish = (...bodies: BodyId[]): void => {
    regen.publish(
      new Map(),
      bodies.map((body) => ({ body, feature: fid(body.split('/')[0] ?? '') })),
    );
  };
  return {
    registry,
    exporter,
    actions,
    editor,
    mode,
    hidden,
    publish,
    state,
    enabled: (id: string): boolean => state(id).enabled,
  };
}

describe('createFileActions', () => {
  it('registers both actions in the file group, labelled by id, without shortcuts', () => {
    const { state } = setup();
    for (const id of [FILE_ACTION_IDS.exportStep, FILE_ACTION_IDS.exportDocument]) {
      expect(state(id)).toMatchObject({ id, label: id, group: 'file', shortcut: null });
      expect(state(id).modes).toEqual(['model']);
    }
    expect(FILE_ACTION_IDS).toEqual({
      exportStep: 'file.exportStep',
      exportDocument: 'file.exportDocument',
    });
  });

  it('starts idle', () => {
    const { actions } = setup();
    expect(actions.status.get()).toEqual(IDLE);
  });

  describe('exportStep', () => {
    it('is disabled without bodies and enabled with one', () => {
      const { enabled, publish } = setup();
      expect(enabled(FILE_ACTION_IDS.exportStep)).toBe(false);
      publish(A);
      expect(enabled(FILE_ACTION_IDS.exportStep)).toBe(true);
    });

    it('is disabled when all bodies are hidden', () => {
      const { enabled, publish, hidden } = setup();
      publish(A, B);
      hidden.set(new Set([A, B]));
      expect(enabled(FILE_ACTION_IDS.exportStep)).toBe(false);
      hidden.set(new Set([A]));
      expect(enabled(FILE_ACTION_IDS.exportStep)).toBe(true);
    });

    it('is disabled while a feature dialog is open', () => {
      const { enabled, publish, editor } = setup();
      publish(A);
      const edit = editor.create('box');
      expect(enabled(FILE_ACTION_IDS.exportStep)).toBe(false);
      edit.cancel();
      expect(enabled(FILE_ACTION_IDS.exportStep)).toBe(true);
    });

    it('is disabled in the sketch mode', () => {
      const { enabled, publish, mode, registry } = setup();
      publish(A);
      mode.set('sketch');
      expect(enabled(FILE_ACTION_IDS.exportStep)).toBe(false);
      expect(registry.run(FILE_ACTION_IDS.exportStep)).toBe(false);
      mode.set('model');
      expect(enabled(FILE_ACTION_IDS.exportStep)).toBe(true);
    });

    it('exports only the visible bodies in the order of the snapshot', () => {
      const { registry, exporter, publish, hidden } = setup();
      publish(C, A, B);
      hidden.set(new Set([A]));
      expect(registry.run(FILE_ACTION_IDS.exportStep)).toBe(true);
      expect(exporter.calls).toEqual([{ task: 'step', bodies: [C, B] }]);
    });
  });

  describe('exportDocument', () => {
    it('is enabled without bodies and with an open dialog', () => {
      const { enabled, editor, registry, exporter } = setup();
      expect(enabled(FILE_ACTION_IDS.exportDocument)).toBe(true);
      editor.create('box');
      expect(enabled(FILE_ACTION_IDS.exportDocument)).toBe(true);
      expect(registry.run(FILE_ACTION_IDS.exportDocument)).toBe(true);
      expect(exporter.calls).toEqual([{ task: 'document' }]);
    });
  });

  describe('running', () => {
    it('disables both actions while an export runs, idle after it settles', async () => {
      const { registry, exporter, actions, enabled, publish } = setup();
      publish(A);
      registry.run(FILE_ACTION_IDS.exportStep);
      expect(actions.status.get()).toEqual({ kind: 'running', task: 'step' });
      expect(enabled(FILE_ACTION_IDS.exportStep)).toBe(false);
      expect(enabled(FILE_ACTION_IDS.exportDocument)).toBe(false);
      expect(registry.run(FILE_ACTION_IDS.exportDocument)).toBe(false);
      expect(exporter.calls).toHaveLength(1);
      exporter.resolve();
      await flush();
      expect(actions.status.get()).toEqual(IDLE);
      expect(enabled(FILE_ACTION_IDS.exportStep)).toBe(true);
      expect(enabled(FILE_ACTION_IDS.exportDocument)).toBe(true);
    });

    it('fails with the message of the error, dismiss returns to idle', async () => {
      const { registry, exporter, actions, enabled } = setup();
      registry.run(FILE_ACTION_IDS.exportDocument);
      expect(actions.status.get()).toEqual({ kind: 'running', task: 'document' });
      exporter.reject(new Error('disk full'));
      await flush();
      expect(actions.status.get()).toEqual({
        kind: 'failed',
        task: 'document',
        message: 'disk full',
      });
      expect(enabled(FILE_ACTION_IDS.exportDocument)).toBe(true);
      actions.dismiss();
      expect(actions.status.get()).toEqual(IDLE);
    });

    it('uses String(e) for a rejection that is not an Error', async () => {
      const { registry, exporter, actions, publish } = setup();
      publish(A);
      registry.run(FILE_ACTION_IDS.exportStep);
      exporter.reject('no kernel');
      await flush();
      expect(actions.status.get()).toEqual({ kind: 'failed', task: 'step', message: 'no kernel' });
    });

    it('a new run overwrites failed', async () => {
      const { registry, exporter, actions } = setup();
      registry.run(FILE_ACTION_IDS.exportDocument);
      exporter.reject(new Error('x'));
      await flush();
      registry.run(FILE_ACTION_IDS.exportDocument);
      expect(actions.status.get()).toEqual({ kind: 'running', task: 'document' });
    });

    it('a document exported without history → idle with the warning (M19.1, D4)', async () => {
      const { registry, exporter, actions } = setup();
      registry.run(FILE_ACTION_IDS.exportDocument);
      exporter.resolve({ withHistory: false });
      await flush();
      expect(actions.status.get()).toEqual({
        kind: 'idle',
        warning: 'file.exportedWithoutHistory',
      });
      expect(Object.isFrozen(actions.status.get())).toBe(true);
    });

    it('a document exported with its history → idle without a warning', async () => {
      const { registry, exporter, actions } = setup();
      registry.run(FILE_ACTION_IDS.exportDocument);
      exporter.resolve({ withHistory: true });
      await flush();
      expect(actions.status.get()).toEqual(IDLE);
    });

    it('dismiss clears the warning', async () => {
      const { registry, exporter, actions } = setup();
      registry.run(FILE_ACTION_IDS.exportDocument);
      exporter.resolve({ withHistory: false });
      await flush();
      actions.dismiss();
      expect(actions.status.get()).toEqual(IDLE);
    });

    it('a new run replaces the warning; a full export then leaves none', async () => {
      const { registry, exporter, actions } = setup();
      registry.run(FILE_ACTION_IDS.exportDocument);
      exporter.resolve({ withHistory: false });
      await flush();
      registry.run(FILE_ACTION_IDS.exportDocument);
      expect(actions.status.get()).toEqual({ kind: 'running', task: 'document' });
      exporter.resolve({ withHistory: true });
      await flush();
      expect(actions.status.get()).toEqual(IDLE);
    });

    it('dismiss does nothing unless failed or warned', () => {
      const { registry, actions } = setup();
      actions.dismiss();
      expect(actions.status.get()).toEqual(IDLE);
      registry.run(FILE_ACTION_IDS.exportDocument);
      actions.dismiss();
      expect(actions.status.get()).toEqual({ kind: 'running', task: 'document' });
    });
  });

  it('dispose unsubscribes the sources of enabled', () => {
    const { actions, enabled, publish, hidden } = setup();
    publish(A);
    actions.dispose();
    hidden.set(new Set([A]));
    expect(enabled(FILE_ACTION_IDS.exportStep)).toBe(true);
  });
});
