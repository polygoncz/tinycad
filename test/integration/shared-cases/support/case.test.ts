// The envelope of a shared case (spec 13, Obálka): an unknown kind or property is a load error,
// not a skip; a case lives in the folder of its area and is named after its file.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CASE_KINDS, areaOfKind, loadCases, parseCase } from './case';

const VALID = {
  kind: 'schema.visibleWhen',
  description: 'A case',
  source: 'test/unit/x.test.ts › y',
  input: { type: 'extrude', param: 'flip', params: {} },
  expected: { ok: { visible: false } },
  tolerance: { length: 1e-3 },
};

/** The object without the keys. */
function omit(value: object, ...keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

const WHERE = { area: 'schema', name: 'a-case', requireExpected: true } as const;

describe('parseCase', () => {
  it('reads a valid envelope', () => {
    expect(parseCase(VALID, WHERE)).toEqual({
      area: 'schema',
      name: 'a-case',
      kind: 'schema.visibleWhen',
      description: 'A case',
      source: 'test/unit/x.test.ts › y',
      input: VALID.input,
      expected: { ok: { visible: false } },
      tolerance: { length: 1e-3 },
    });
  });

  it('reads an envelope without the optional properties', () => {
    const parsed = parseCase(omit(VALID, 'source', 'tolerance'), WHERE);
    expect(parsed.source).toBeUndefined();
    expect(parsed.tolerance).toBeUndefined();
  });

  it('reads an error outcome', () => {
    const error = { code: 'K', path: 'a.b', issues: [{ path: 'x' }, { path: 'y', code: 'c' }] };
    expect(parseCase({ ...VALID, expected: { error } }, WHERE).expected).toEqual({ error });
  });

  it('rejects an unknown kind', () => {
    expect(() => parseCase({ ...VALID, kind: 'schema.unknown' }, WHERE)).toThrow(
      /unknown kind 'schema\.unknown'/,
    );
  });

  it('rejects an unknown property of the envelope', () => {
    expect(() => parseCase({ ...VALID, notes: 'x' }, WHERE)).toThrow(/unknown property 'notes'/);
  });

  it('rejects a missing required property', () => {
    expect(() => parseCase(omit(VALID, 'description'), WHERE)).toThrow(/'description'/);
    expect(() => parseCase(omit(VALID, 'input'), WHERE)).toThrow(/'input'/);
  });

  it('requires expected unless recording', () => {
    const rest = omit(VALID, 'expected');
    expect(() => parseCase(rest, WHERE)).toThrow(/'expected'/);
    expect(parseCase(rest, { ...WHERE, requireExpected: false }).expected).toBeUndefined();
  });

  it('rejects a malformed expected', () => {
    expect(() => parseCase({ ...VALID, expected: {} }, WHERE)).toThrow(/expected/);
    expect(() => parseCase({ ...VALID, expected: { ok: 1, error: {} } }, WHERE)).toThrow(
      /expected/,
    );
    expect(() => parseCase({ ...VALID, expected: { error: { message: 'x' } } }, WHERE)).toThrow(
      /message/,
    );
    expect(() => parseCase({ ...VALID, expected: { error: { issues: [{}] } } }, WHERE)).toThrow(
      /issues/,
    );
  });

  it('rejects a malformed tolerance', () => {
    expect(() => parseCase({ ...VALID, tolerance: { volume: 1 } }, WHERE)).toThrow(/volume/);
    expect(() => parseCase({ ...VALID, tolerance: { length: '1' } }, WHERE)).toThrow(/length/);
  });

  it('rejects a kind of another area', () => {
    expect(() => parseCase({ ...VALID, kind: 'regen' }, WHERE)).toThrow(/area 'regen'/);
  });

  it('rejects a name that is not kebab-case', () => {
    expect(() => parseCase(VALID, { ...WHERE, name: 'A_case' })).toThrow(/kebab-case/);
  });
});

describe('areaOfKind', () => {
  it('maps every kind of spec 13 to its area', () => {
    expect(CASE_KINDS.map((kind) => [kind, areaOfKind(kind)])).toEqual([
      ['ops.upcast', 'ops'],
      ['ops.replay', 'ops'],
      ['ops.script', 'ops'],
      ['document.load', 'document'],
      ['schema.validate', 'schema'],
      ['schema.visibleWhen', 'schema'],
      ['regen', 'regen'],
      ['geometry.intersections', 'geometry'],
      ['geometry.segment', 'geometry'],
      ['geometry.fillet', 'geometry'],
      ['geometry.offset', 'geometry'],
      ['sketch.solve', 'sketch'],
      ['sketch.derived', 'sketch'],
    ]);
  });
});

describe('loadCases', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shared-cases-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeCase(name: string, content: unknown): Promise<void> {
    await mkdir(join(root, 'schema'), { recursive: true });
    await writeFile(join(root, 'schema', name), JSON.stringify(content));
  }

  it('loads every case of the area sorted by name, with its file', async () => {
    await writeCase('b-case.json', VALID);
    await writeCase('a-case.json', VALID);
    await writeCase('notes.txt', 'ignored');
    const cases = loadCases('schema', { root, requireExpected: true });
    expect(cases.map((c) => c.name)).toEqual(['a-case', 'b-case']);
    expect(cases[0]?.file).toBe(join(root, 'schema', 'a-case.json'));
  });

  it('names the file in a load error', async () => {
    await writeCase('bad-case.json', { ...VALID, kind: 'nope' });
    expect(() => loadCases('schema', { root, requireExpected: true })).toThrow(/bad-case\.json/);
  });

  it('names the file when the JSON is broken', async () => {
    await mkdir(join(root, 'schema'), { recursive: true });
    await writeFile(join(root, 'schema', 'broken.json'), '{');
    expect(() => loadCases('schema', { root, requireExpected: true })).toThrow(/broken\.json/);
  });
});
