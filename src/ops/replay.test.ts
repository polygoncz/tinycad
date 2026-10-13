import { describe, expect, it } from 'vitest';
import type { FeatureId } from '@/document';
import { createFeatureSchemaRegistry, toData } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { createOpHandlerRegistry } from './handler';
import type { LogEntry } from './log';
import type { FeatureRemoveOp, FeatureRenameOp, Operation } from './operation';
import { replayLog } from './replay';

const id = (s: string): FeatureId => s as FeatureId;
const handlers = createOpHandlerRegistry({ schemas: createFeatureSchemaRegistry() });

function entry(seq: number, kind: LogEntry['kind'], op: Operation, target?: number): LogEntry {
  return {
    seq,
    kind,
    ...(target === undefined ? {} : { target }),
    op,
    inverse: op,
    label: op.type,
    time: 0,
  };
}
const rename = (name: string): FeatureRenameOp => ({
  type: 'feature.rename',
  v: 1,
  featureId: id('a'),
  name,
});

const remove: FeatureRemoveOp = { type: 'feature.remove', v: 1, featureId: id('zzz') };

describe('replayLog', () => {
  it('applies op of every entry in order, undo entries included', () => {
    const doc = aDocument({ features: [aFeature({ id: 'a', name: 'A' })] });
    replayLog(doc, handlers, [
      entry(1, 'do', rename('A1')),
      entry(2, 'do', rename('A2')),
      entry(3, 'undo', rename('A1'), 2),
    ]);
    expect(doc.studio.features[0]?.name).toBe('A1');
  });

  it('reproduces a live document', () => {
    const live = aDocument({ features: [aFeature({ id: 'a', name: 'A' })] });
    const replayed = aDocument({ features: [aFeature({ id: 'a', name: 'A' })] });
    const entries = [entry(1, 'do', rename('X'))];
    replayLog(live, handlers, entries);
    replayLog(replayed, handlers, entries);
    expect(toData(replayed)).toEqual(toData(live));
  });

  it('a failing handler throws at once', () => {
    const doc = aDocument({ features: [aFeature({ id: 'a', name: 'A' })] });
    expect(() => {
      replayLog(doc, handlers, [entry(1, 'do', remove), entry(2, 'do', rename('late'))]);
    }).toThrow();
    expect(doc.studio.features[0]?.name).toBe('A');
  });

  it('runs to the end and throws a single subscriber exception as is', () => {
    const doc = aDocument({ features: [aFeature({ id: 'a', name: 'A' })] });
    const err = new Error('subscriber');
    let first = true;
    doc.events.on('changed', () => {
      if (!first) return;
      first = false;
      throw err;
    });
    let caught: unknown;
    try {
      replayLog(doc, handlers, [entry(1, 'do', rename('A1')), entry(2, 'do', rename('A2'))]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(err);
    expect(doc.studio.features[0]?.name).toBe('A2');
  });

  it('throws AggregateError for several subscriber exceptions', () => {
    const doc = aDocument({ features: [aFeature({ id: 'a', name: 'A' })] });
    doc.events.on('changed', () => {
      throw new Error('subscriber');
    });
    expect(() => {
      replayLog(doc, handlers, [entry(1, 'do', rename('A1')), entry(2, 'do', rename('A2'))]);
    }).toThrow(AggregateError);
  });
});
