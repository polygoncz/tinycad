import { describe, expect, it } from 'vitest';
import { createFeatureSchemaRegistry } from '@/document';
import { aDocument, aFeature, toData } from '@/document/testing';
import { createOpHandlerRegistry } from '@/ops/handler';
import { OP_VERSION } from '@/ops/operation';
import type { DocumentRenameOp } from '@/ops/operation';
import { anOpsSession } from '@/ops/testing';

const handlers = createOpHandlerRegistry({ schemas: createFeatureSchemaRegistry() });
const handler = handlers.get('document.rename');

const renameTo = (name: string): DocumentRenameOp => ({
  type: 'document.rename',
  v: OP_VERSION['document.rename'],
  name,
});

function setup() {
  return aDocument({ meta: { name: 'Old' }, features: [aFeature({ id: 'a' })] });
}

describe('document.rename (M19.2, D5)', () => {
  it('is built in with version 1', () => {
    expect(OP_VERSION['document.rename']).toBe(1);
    expect(handler.version).toBe(1);
  });

  it('apply renames the document and keeps the studio', () => {
    const doc = setup();
    const studio = doc.studio;
    handler.apply(doc, renameTo('New'));
    expect(doc.meta.name).toBe('New');
    expect(doc.studio).toBe(studio);
  });

  it('invert is a rename to the current name and does not change the document', () => {
    const doc = setup();
    const before = toData(doc);
    expect(handler.invert(doc, renameTo('New'))).toEqual(renameTo('Old'));
    expect(toData(doc)).toEqual(before);
  });

  it('apply then apply(inverse) restores the original', () => {
    const doc = setup();
    const before = toData(doc);
    const inverse = handler.invert(doc, renameTo('New'));
    handler.apply(doc, renameTo('New'));
    handlers.get(inverse.type).apply(doc, inverse);
    expect(toData(doc)).toEqual(before);
  });

  it('goes through the dispatcher as a log entry with the op type as label', () => {
    const { doc, dispatcher, log } = anOpsSession({ meta: { name: 'Old' } });
    void dispatcher.dispatch(renameTo('New'));
    const [entry] = log.entries();
    expect(doc.meta.name).toBe('New');
    expect(entry).toMatchObject({ kind: 'do', op: renameTo('New'), inverse: renameTo('Old') });
    expect(entry?.label).toBe('document.rename');
  });

  it('validate: a valid operation passes', () => {
    const raw = { type: 'document.rename', v: 1, name: 'Díl' };
    expect(handler.validate?.(raw)).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['a space at the start', ' Díl'],
    ['a space at the end', 'Díl '],
    ['only spaces', '   '],
    ['not a string', 7],
    ['null', null],
    ['missing', undefined],
  ])('validate: name %s fails at name', (_, name) => {
    const raw = { type: 'document.rename', v: 1, name };
    expect((handler.validate?.(raw) ?? []).map((e) => e.path)).toEqual(['name']);
  });

  it('dispatch of an invalid name throws and changes nothing', () => {
    const { doc, dispatcher, log } = anOpsSession({ meta: { name: 'Old' } });
    expect(() => dispatcher.dispatch(renameTo(' x'))).toThrow(/Invalid operation/);
    expect(doc.meta.name).toBe('Old');
    expect(log.lastSeq).toBe(0);
  });
});
