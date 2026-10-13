import { describe, expect, it } from 'vitest';
import type { DocumentWriter, FeatureId } from '@/document';
import { createFeatureSchemaRegistry } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { createOperationDispatcher } from './dispatcher';
import { createOpHandlerRegistry } from './handler';
import { createOperationLog } from './log';
import type { OpHandler } from './op-handler';
import type { FeatureRenameOp, FeatureSetParamsOp } from './operation';

const id = (s: string): FeatureId => s as FeatureId;
const rename = (featureId: string, name: string): FeatureRenameOp => ({
  type: 'feature.rename',
  v: 1,
  featureId: id(featureId),
  name,
});

function setup(now?: () => number) {
  const doc = aDocument({ features: [aFeature({ id: 'a', name: 'A' })] });
  const handlers = createOpHandlerRegistry({ schemas: createFeatureSchemaRegistry() });
  const log = createOperationLog();
  const dispatcher = createOperationDispatcher({ doc, handlers, log, ...(now ? { now } : {}) });
  return { doc, handlers, log, dispatcher };
}
const name = (doc: DocumentWriter): string | undefined => doc.studio.features[0]?.name;

describe('dispatch', () => {
  it('runs invert, apply, append, emit in this order', () => {
    const { doc, handlers, log, dispatcher } = setup();
    const calls: string[] = [];
    const spy: OpHandler = {
      type: 'spy',
      version: 1,
      invert: () => {
        calls.push('invert');
        return { type: 'spy', v: 1 };
      },
      apply: () => {
        calls.push('apply');
      },
    };
    handlers.register(spy);
    log.events.on('appended', () => calls.push('append'));
    dispatcher.events.on('applied', () => calls.push('emit'));
    dispatcher.dispatch({ type: 'spy', v: 1 });
    expect(calls).toEqual(['invert', 'apply', 'append', 'emit']);
    expect(doc.studio.features).toHaveLength(1);
  });

  it('writes the entry with inverse, default label and time from now', () => {
    const { doc, log, dispatcher } = setup(() => 42);
    const entry = dispatcher.dispatch(rename('a', 'X'));
    expect(name(doc)).toBe('X');
    expect(entry).toMatchObject({
      seq: 1,
      kind: 'do',
      label: 'feature.rename',
      time: 42,
      inverse: rename('a', 'A'),
    });
    expect(entry.target).toBeUndefined();
    expect(log.entries()).toEqual([entry]);
  });

  it('uses the label from meta', () => {
    const { dispatcher } = setup();
    expect(dispatcher.dispatch(rename('a', 'X'), { label: 'Rename' }).label).toBe('Rename');
  });

  it('emits applied with the entry and the operation', () => {
    const { dispatcher } = setup();
    const seen: unknown[] = [];
    dispatcher.events.on('applied', (e) => seen.push(e));
    const op = rename('a', 'X');
    const entry = dispatcher.dispatch(op);
    expect(seen).toEqual([{ entry, op }]);
  });

  it('is not in a transaction', () => {
    expect(setup().dispatcher.inTransaction).toBe(false);
  });

  it('writes nothing and emits nothing when the handler fails', () => {
    const { doc, log, dispatcher } = setup();
    let emitted = 0;
    dispatcher.events.on('applied', () => emitted++);
    expect(() => dispatcher.dispatch(rename('missing', 'X'))).toThrow();
    expect(name(doc)).toBe('A');
    expect(log.lastSeq).toBe(0);
    expect(emitted).toBe(0);
  });

  it('writes the entry, emits applied and then throws when a document subscriber throws', () => {
    const { doc, log, dispatcher } = setup();
    const boom = new Error('doc subscriber');
    doc.events.on('changed', () => {
      throw boom;
    });
    let emitted = 0;
    dispatcher.events.on('applied', () => emitted++);
    expect(() => dispatcher.dispatch(rename('a', 'X'))).toThrow(boom);
    expect(name(doc)).toBe('X');
    expect(log.lastSeq).toBe(1);
    expect(emitted).toBe(1);
  });

  it('does not skip applied when an appended subscriber throws, and throws at the end', () => {
    const { log, dispatcher } = setup();
    const boom = new Error('appended subscriber');
    log.events.on('appended', () => {
      throw boom;
    });
    let emitted = 0;
    dispatcher.events.on('applied', () => emitted++);
    expect(() => dispatcher.dispatch(rename('a', 'X'))).toThrow(boom);
    expect(log.lastSeq).toBe(1);
    expect(emitted).toBe(1);
  });

  it('collects errors of all steps into an AggregateError in step order', () => {
    const { doc, log, dispatcher } = setup();
    const e2 = new Error('doc');
    const e3 = new Error('appended');
    const e4 = new Error('applied');
    doc.events.on('changed', () => {
      throw e2;
    });
    log.events.on('appended', () => {
      throw e3;
    });
    dispatcher.events.on('applied', () => {
      throw e4;
    });
    let caught: unknown;
    try {
      dispatcher.dispatch(rename('a', 'X'));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([e2, e3, e4]); // narrowed by the check above
    expect(log.lastSeq).toBe(1);
  });

  it('records an operation that does not change the document', () => {
    const { log, dispatcher } = setup();
    dispatcher.dispatch(rename('a', 'A'));
    expect(log.lastSeq).toBe(1);
  });
});

describe('dispatch – meta consistency', () => {
  function expectRejected(meta: Parameters<ReturnType<typeof setup>['dispatcher']['dispatch']>[1]) {
    const { doc, handlers, log, dispatcher } = setup();
    dispatcher.dispatch(rename('a', 'X')); // seq 1: kind 'do'
    dispatcher.dispatch(rename('a', 'Y'), { kind: 'undo', target: 1 }); // seq 2: kind 'undo'
    let inverted = 0;
    const handler = handlers.get('feature.rename');
    handlers.register({
      ...handler,
      type: 'probe',
      invert: (d, o) => (inverted++, handler.invert(d, o)),
    });
    const before = log.lastSeq;
    expect(() => dispatcher.dispatch({ type: 'probe', v: 1 }, meta)).toThrow();
    expect(log.lastSeq).toBe(before);
    expect(name(doc)).toBe('Y');
    expect(inverted).toBe(0);
  }

  it('rejects target without kind', () => {
    expectRejected({ target: 1 });
  });
  it("rejects target with kind 'do'", () => {
    expectRejected({ kind: 'do', target: 1 });
  });
  it('rejects undo without target', () => {
    expectRejected({ kind: 'undo' });
  });
  it('rejects redo without target', () => {
    expectRejected({ kind: 'redo' });
  });
  it('rejects a target that does not exist', () => {
    expectRejected({ kind: 'undo', target: 9 });
  });
  it('rejects target 0', () => {
    expectRejected({ kind: 'undo', target: 0 });
  });
  it("rejects a target that is not a 'do' entry", () => {
    expectRejected({ kind: 'redo', target: 2 });
  });

  it('accepts undo with a valid target', () => {
    const { dispatcher } = setup();
    dispatcher.dispatch(rename('a', 'X'));
    const entry = dispatcher.dispatch(rename('a', 'A'), { kind: 'undo', target: 1 });
    expect(entry).toMatchObject({ kind: 'undo', target: 1, seq: 2 });
  });
});

describe('reentrance', () => {
  function setupRe() {
    const doc = aDocument({ features: [aFeature({ id: 'a', params: { size: 0 } })] });
    const handlers = createOpHandlerRegistry({ schemas: createFeatureSchemaRegistry() });
    const log = createOperationLog();
    const dispatcher = createOperationDispatcher({ doc, handlers, log });
    return { doc, log, dispatcher };
  }
  const set = (size: number): FeatureSetParamsOp => ({
    type: 'feature.setParams',
    v: 2,
    featureId: 'a' as FeatureId,
    typeVersion: 1,
    params: { size },
  });

  it('dispatch and begin from a changed subscriber throw; the outer op is written', () => {
    const { doc, log, dispatcher } = setupRe();
    const inner: unknown[] = [];
    doc.events.on('changed', () => {
      for (const f of [() => dispatcher.dispatch(set(7)), () => dispatcher.begin('x')]) {
        try {
          f();
          inner.push('no throw');
        } catch (e) {
          inner.push(e);
        }
      }
      throw new Error('subscriber done');
    });
    let thrown: unknown;
    try {
      dispatcher.dispatch(set(1));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toEqual(new Error('subscriber done'));
    expect(inner.every((e) => e instanceof Error)).toBe(true);
    expect(inner).toHaveLength(2);
    expect(log.lastSeq).toBe(1);
    expect(dispatcher.inTransaction).toBe(false);
  });

  it('the flag is cleared after a failing handler', () => {
    const { log, dispatcher } = setupRe();
    const missing: FeatureSetParamsOp = { ...set(1), featureId: 'missing' as FeatureId };
    expect(() => dispatcher.dispatch(missing)).toThrow();
    dispatcher.dispatch(set(2));
    expect(log.lastSeq).toBe(1);
  });

  it('an applied subscriber may dispatch', () => {
    const { log, dispatcher } = setupRe();
    let once = true;
    dispatcher.events.on('applied', () => {
      if (!once) return;
      once = false;
      dispatcher.dispatch(set(3));
    });
    dispatcher.dispatch(set(1));
    expect(log.lastSeq).toBe(2);
  });
});
