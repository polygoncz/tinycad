import { describe, expect, it } from 'vitest';
import { createOpHandlerRegistry } from './handler';
import type { OpHandler } from './op-handler';
import type { Operation } from './operation';
import { upcastOperation } from './upcast';

interface PingOp extends Operation {
  readonly type: 'test.ping';
  readonly n: number;
}

function registryWith(upcast?: OpHandler['upcast'], version = 2) {
  const registry = createOpHandlerRegistry();
  const handler: OpHandler = {
    type: 'test.ping',
    version,
    invert: (_doc, op) => op,
    apply: () => undefined,
    ...(upcast === undefined ? {} : { upcast }),
  };
  registry.register(handler);
  return registry;
}

const migrate: OpHandler['upcast'] = (from, raw) => {
  const old = raw as { n: number };
  expect(from).toBe(1);
  return { type: 'test.ping', v: 2, n: old.n * 10 } as PingOp;
};

describe('upcastOperation', () => {
  const handlers = createOpHandlerRegistry();

  it('returns the current version unchanged', () => {
    const raw = { type: 'feature.rename', v: 1, featureId: 'a', name: 'x' };
    const r = upcastOperation(handlers, raw);
    expect(r).toEqual({ ok: true, value: raw });
  });

  it('migrates an older version with upcast', () => {
    const r = upcastOperation(registryWith(migrate), { type: 'test.ping', v: 1, n: 4 });
    expect(r).toEqual({ ok: true, value: { type: 'test.ping', v: 2, n: 40 } });
  });

  it('fails when an older version has no upcast', () => {
    const r = upcastOperation(registryWith(), { type: 'test.ping', v: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.path).toBe('v');
  });

  it('fails on a newer version', () => {
    const r = upcastOperation(handlers, { type: 'feature.rename', v: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.path).toBe('v');
  });

  it('fails on an unknown type', () => {
    const r = upcastOperation(handlers, { type: 'nope', v: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.path).toBe('type');
  });

  it.each([
    [null, ''],
    [[], ''],
    ['x', ''],
    [{ v: 1 }, 'type'],
    [{ type: 5, v: 1 }, 'type'],
    [{ type: 'feature.rename' }, 'v'],
    [{ type: 'feature.rename', v: 0 }, 'v'],
    [{ type: 'feature.rename', v: 1.5 }, 'v'],
    [{ type: 'feature.rename', v: '1' }, 'v'],
  ])('reports a broken envelope %j at path %j', (raw, path) => {
    const r = upcastOperation(handlers, raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.path).toBe(path);
  });

  it('upcasts a batch recursively', () => {
    const r = upcastOperation(registryWith(migrate), {
      type: 'batch',
      v: 1,
      ops: [
        { type: 'test.ping', v: 1, n: 1 },
        { type: 'batch', v: 1, ops: [{ type: 'test.ping', v: 1, n: 2 }] },
      ],
    });
    expect(r).toEqual({
      ok: true,
      value: {
        type: 'batch',
        v: 1,
        ops: [
          { type: 'test.ping', v: 2, n: 10 },
          { type: 'batch', v: 1, ops: [{ type: 'test.ping', v: 2, n: 20 }] },
        ],
      },
    });
  });

  it('reports errors inside a batch with a composed path', () => {
    const r = upcastOperation(handlers, {
      type: 'batch',
      v: 1,
      ops: [
        { type: 'feature.rename', v: 1, featureId: 'a', name: 'x' },
        { type: 'feature.rename', v: 1, featureId: 'a', name: 'y' },
        { type: 'feature.rename', v: 0 },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.path).toBe('ops[2].v');
  });

  it('reports nested batch and non-object sub-operation paths', () => {
    const nested = upcastOperation(handlers, {
      type: 'batch',
      v: 1,
      ops: [{ type: 'batch', v: 1, ops: [null] }],
    });
    expect(!nested.ok && nested.error.path).toBe('ops[0].ops[0]');
  });

  it('reports a batch without an ops array and a newer batch version', () => {
    const a = upcastOperation(handlers, { type: 'batch', v: 1, ops: 3 });
    expect(!a.ok && a.error.path).toBe('ops');
    const b = upcastOperation(handlers, { type: 'batch', v: 2, ops: [] });
    expect(!b.ok && b.error.path).toBe('v');
  });

  it('throws when upcast returns a wrong version', () => {
    const bad = registryWith(() => ({ type: 'test.ping', v: 1 }));
    expect(() => upcastOperation(bad, { type: 'test.ping', v: 1 })).toThrow();
  });
});
