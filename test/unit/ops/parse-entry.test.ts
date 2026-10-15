import { describe, expect, it } from 'vitest';
import { createFeatureSchemaRegistry } from '@/document';
import { createOpHandlerRegistry } from '@/ops/handler';
import type { Operation } from '@/ops/operation';
import { parseLogEntry } from '@/ops/parse-entry';

const handlers = createOpHandlerRegistry({ schemas: createFeatureSchemaRegistry() });

const op = { type: 'feature.rename', v: 1, featureId: 'f1', name: 'New' };
const inverse = { type: 'feature.rename', v: 1, featureId: 'f1', name: 'Old' };

const doEntry = { seq: 1, kind: 'do', op, inverse, label: 'Rename', time: 1000 };
const undoEntry = { ...doEntry, seq: 2, kind: 'undo', target: 1, op: inverse, inverse: op };
const redoEntry = { ...doEntry, seq: 3, kind: 'redo', target: 1 };

const without = (raw: Readonly<Record<string, unknown>>, key: string) =>
  Object.fromEntries(Object.entries(raw).filter(([k]) => k !== key));

describe('parseLogEntry', () => {
  it.each([doEntry, undoEntry, redoEntry])('accepts a valid %j', (raw) => {
    expect(parseLogEntry(handlers, raw)).toEqual({ ok: true, value: raw });
  });

  it('returns a new object with known fields only', () => {
    const raw = { ...doEntry, docId: 'd1', extra: true };
    const r = parseLogEntry(handlers, raw);
    expect(r).toEqual({ ok: true, value: doEntry });
    if (r.ok) expect(r.value).not.toBe(raw);
  });

  it.each([
    [null, ''],
    [[], ''],
    ['x', ''],
    [without(doEntry, 'seq'), 'seq'],
    [{ ...doEntry, seq: 0 }, 'seq'],
    [{ ...doEntry, seq: 1.5 }, 'seq'],
    [{ ...doEntry, seq: '1' }, 'seq'],
    [without(doEntry, 'kind'), 'kind'],
    [{ ...doEntry, kind: 'redo-all' }, 'kind'],
    [without(doEntry, 'label'), 'label'],
    [{ ...doEntry, label: 3 }, 'label'],
    [without(doEntry, 'time'), 'time'],
    [{ ...doEntry, time: Number.NaN }, 'time'],
    [{ ...doEntry, time: Number.POSITIVE_INFINITY }, 'time'],
    [{ ...doEntry, time: '1000' }, 'time'],
    [{ ...doEntry, target: 1, seq: 2 }, 'target'],
    [without(undoEntry, 'target'), 'target'],
    [{ ...undoEntry, target: 0 }, 'target'],
    [{ ...undoEntry, target: 2 }, 'target'],
    [{ ...redoEntry, target: 4 }, 'target'],
    [{ ...redoEntry, target: 1.5 }, 'target'],
    [without(doEntry, 'op'), 'op'],
    [without(doEntry, 'inverse'), 'inverse'],
    [{ ...doEntry, op: { ...op, featureId: '' } }, 'op.featureId'],
    [{ ...doEntry, inverse: { ...inverse, name: 1 } }, 'inverse.name'],
    [{ ...doEntry, op: { ...op, v: 2 } }, 'op.v'],
    [{ ...doEntry, inverse: { type: 'nope', v: 1 } }, 'inverse.type'],
    [{ ...doEntry, op: { type: 'batch', v: 1, ops: [{ ...op, v: 0 }] } }, 'op.ops[0].v'],
  ])('rejects %j at path %j', (raw, path) => {
    const r = parseLogEntry(handlers, raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.path).toBe(path);
  });

  it('upcasts an older operation version inside the entry', () => {
    const registry = createOpHandlerRegistry({ schemas: createFeatureSchemaRegistry() });
    registry.register({
      type: 'test.ping',
      version: 2,
      invert: (_doc, o) => o,
      apply: () => undefined,
      upcast: (_from, raw) => ({ ...(raw as Operation), v: 2 }),
    });
    const r = parseLogEntry(registry, {
      ...doEntry,
      op: { type: 'test.ping', v: 1 },
      inverse: { type: 'test.ping', v: 2 },
    });
    expect(r).toEqual({
      ok: true,
      value: { ...doEntry, op: { type: 'test.ping', v: 2 }, inverse: { type: 'test.ping', v: 2 } },
    });
  });
});
