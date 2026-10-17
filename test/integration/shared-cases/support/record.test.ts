// The record mode of shared cases (spec 13, Soubory a běh): only expected is replaced, the inputs
// stay, the JSON has a 2-space indent and a trailing newline, and a second record changes nothing.

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isRecordMode, recordExpected } from './record';

const INPUT = {
  kind: 'schema.visibleWhen',
  description: 'A case',
  source: 'test/unit/x.test.ts › y',
  input: { type: 'revolve', param: 'flip', params: { angle: 1e-7, list: [1, 2] } },
  expected: { ok: { visible: false } },
  tolerance: { length: 1e-3 },
};

describe('recordExpected', () => {
  let dir = '';
  let file = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shared-cases-record-'));
    file = join(dir, 'a-case.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('replaces expected and keeps the inputs and the order of the properties', async () => {
    await writeFile(file, JSON.stringify(INPUT));
    expect(await recordExpected(file, { ok: { visible: true } })).toBe(true);
    const text = await readFile(file, 'utf8');
    expect(text).toBe(
      JSON.stringify({ ...INPUT, expected: { ok: { visible: true } } }, null, 2) + '\n',
    );
    expect(Object.keys(JSON.parse(text) as object)).toEqual(Object.keys(INPUT));
  });

  it('adds a missing expected right after the input', async () => {
    const noExpected = Object.entries(INPUT).filter(([key]) => key !== 'expected');
    await writeFile(file, JSON.stringify(Object.fromEntries(noExpected)));
    await recordExpected(file, { error: { code: 'X' } });
    const written = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(written)).toEqual([
      'kind',
      'description',
      'source',
      'input',
      'expected',
      'tolerance',
    ]);
    expect(written['expected']).toEqual({ error: { code: 'X' } });
  });

  it('changes nothing on a second record', async () => {
    await writeFile(file, JSON.stringify(INPUT));
    await recordExpected(file, { ok: { visible: true } });
    const first = await readFile(file, 'utf8');
    const { mtimeMs } = await stat(file);
    expect(await recordExpected(file, { ok: { visible: true } })).toBe(false);
    expect(await readFile(file, 'utf8')).toBe(first);
    expect((await stat(file)).mtimeMs).toBe(mtimeMs);
  });
});

describe('isRecordMode', () => {
  it('is on exactly with CASES_RECORD=1', () => {
    expect(isRecordMode({ CASES_RECORD: '1' })).toBe(true);
    expect(isRecordMode({})).toBe(false);
    expect(isRecordMode({ CASES_RECORD: '0' })).toBe(false);
  });
});
