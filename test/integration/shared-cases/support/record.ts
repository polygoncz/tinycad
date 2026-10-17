// The record mode of shared cases (spec 13, Soubory a běh; Q107): with CASES_RECORD=1 a runner
// does not read expected but writes the output of the TS domain into it. The inputs (kind,
// description, source, input, tolerance) are never changed; the JSON has a 2-space indent, the
// keys in the order the runner made them, and a trailing newline.

import { readFile, writeFile } from 'node:fs/promises';
import type { CaseOutcome } from './case';

/** Whether the runners record instead of compare: exactly CASES_RECORD=1. */
export function isRecordMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env['CASES_RECORD'] === '1';
}

/**
 * Replaces expected in the case file (or adds it right after input) and writes the file only
 * when its text changes, so a second record leaves it untouched. Returns whether it wrote.
 */
export async function recordExpected(file: string, expected: CaseOutcome): Promise<boolean> {
  const before = await readFile(file, 'utf8');
  const raw: unknown = JSON.parse(before);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${file}: a case must be a JSON object`);
  }
  const after = JSON.stringify(withExpected(Object.entries(raw), expected), null, 2) + '\n';
  if (after === before) return false;
  await writeFile(file, after);
  return true;
}

function withExpected(
  entries: readonly (readonly [string, unknown])[],
  expected: CaseOutcome,
): Record<string, unknown> {
  const hasExpected = entries.some(([key]) => key === 'expected');
  const result: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    result[key] = key === 'expected' ? expected : value;
    if (key === 'input' && !hasExpected) result['expected'] = expected;
  }
  return result;
}
