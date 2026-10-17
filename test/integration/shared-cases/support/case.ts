// The envelope of a shared case (spec 13, Sdílené testovací případy › Obálka) and loading the
// cases of an area from test/shared-cases/<area>/. An unknown kind or property is a load error,
// never a skip: a typo in a case must not hide it from the TS or the C++ suite.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The folders of test/shared-cases/ (spec 13, Soubory a běh). */
export const AREAS = ['ops', 'document', 'schema', 'regen', 'geometry', 'sketch'] as const;
export type Area = (typeof AREAS)[number];

/** Every kind of the table of spec 13 (Druhy případů); the part before the dot is the area. */
export const CASE_KINDS = [
  'ops.upcast',
  'ops.replay',
  'ops.script',
  'document.load',
  'schema.validate',
  'schema.visibleWhen',
  'regen',
  'geometry.intersections',
  'geometry.segment',
  'geometry.fillet',
  'geometry.offset',
  'sketch.solve',
  'sketch.derived',
] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

/** The tolerances of a comparison (spec 13, Porovnání a tolerance). */
export interface Tolerance {
  /** Absolute, for numbers in general (mm, curve parameters, counts). */
  readonly length: number;
  /** Absolute, for numbers under the key 'angle' (rad). */
  readonly angle: number;
  /** Relative, for numbers under the key 'volume'. */
  readonly relative: number;
}

/** An issue of an error outcome: its path and code, never the text of the message. */
export interface CaseIssue {
  readonly path: string;
  readonly code?: string;
}

/** An error outcome, compared by code and path only (the texts differ in C++). */
export interface CaseError {
  readonly code?: string;
  readonly path?: string;
  readonly issues?: readonly CaseIssue[];
}

/** What a case expects, or what a runner returns: a JSON output or an error. */
export type CaseOutcome = { readonly ok: unknown } | { readonly error: CaseError };

/** A parsed case; expected is missing only in a hand-written case before its first record. */
export interface SharedCase {
  readonly area: Area;
  /** The file name without .json, kebab-case. */
  readonly name: string;
  readonly kind: CaseKind;
  readonly description: string;
  readonly source?: string;
  readonly input: unknown;
  readonly expected?: CaseOutcome;
  readonly tolerance?: Partial<Tolerance>;
}

/** A case loaded from its file. */
export interface LoadedCase extends SharedCase {
  /** The absolute path of the .json file (the record mode rewrites it). */
  readonly file: string;
}

/** Where a case comes from, for the checks that depend on its file. */
export interface CaseOrigin {
  readonly area: Area;
  readonly name: string;
  /** False in the record mode: a hand-written case gets its expected from the record. */
  readonly requireExpected: boolean;
}

/** The folder test/shared-cases/ of the repository. */
export const SHARED_CASES_ROOT = fileURLToPath(new URL('../../../shared-cases/', import.meta.url));

const ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  'kind',
  'description',
  'source',
  'input',
  'expected',
  'tolerance',
]);
const ERROR_KEYS: ReadonlySet<string> = new Set(['code', 'path', 'issues']);
const ISSUE_KEYS: ReadonlySet<string> = new Set(['path', 'code']);
const TOLERANCE_KEYS: ReadonlySet<string> = new Set(['length', 'angle', 'relative']);
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The area of a kind: the part before the dot ('regen' has none). */
export function areaOfKind(kind: CaseKind): Area {
  const prefix = kind.split('.')[0];
  const area = AREAS.find((a) => a === prefix);
  if (area === undefined) throw new Error(`Kind '${kind}' belongs to no area`);
  return area;
}

/** Checks the envelope of a case (spec 13, Obálka); throws with the reason. */
export function parseCase(raw: unknown, origin: CaseOrigin): SharedCase {
  if (!KEBAB_CASE.test(origin.name)) {
    throw new Error(`The name '${origin.name}' is not kebab-case`);
  }
  if (!isObject(raw)) throw new Error('A case must be a JSON object');
  for (const key of Object.keys(raw)) {
    if (!ENVELOPE_KEYS.has(key)) throw new Error(`unknown property '${key}' of the envelope`);
  }

  const kind = CASE_KINDS.find((k) => k === raw['kind']);
  if (kind === undefined) throw new Error(`unknown kind '${String(raw['kind'])}'`);
  if (areaOfKind(kind) !== origin.area) {
    throw new Error(
      `Kind '${kind}' belongs to the area '${areaOfKind(kind)}', not '${origin.area}'`,
    );
  }

  const description = raw['description'];
  if (typeof description !== 'string') throw new Error(`'description' must be a string`);
  const source = raw['source'];
  if (source !== undefined && typeof source !== 'string') {
    throw new Error(`'source' must be a string`);
  }
  if (!('input' in raw)) throw new Error(`'input' is missing`);

  const expected = raw['expected'] === undefined ? undefined : parseOutcome(raw['expected']);
  if (expected === undefined && origin.requireExpected) {
    throw new Error(`'expected' is missing; run npm run cases:record`);
  }
  const tolerance = raw['tolerance'] === undefined ? undefined : parseTolerance(raw['tolerance']);

  return {
    area: origin.area,
    name: origin.name,
    kind,
    description,
    ...(source === undefined ? {} : { source }),
    input: raw['input'],
    ...(expected === undefined ? {} : { expected }),
    ...(tolerance === undefined ? {} : { tolerance }),
  };
}

/** Every case of the area, sorted by name; a broken file fails the load with its path. */
export function loadCases(
  area: Area,
  options: { readonly root?: string; readonly requireExpected: boolean },
): readonly LoadedCase[] {
  const dir = join(options.root ?? SHARED_CASES_ROOT, area);
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => {
      const file = join(dir, entry);
      try {
        const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
        const name = entry.slice(0, -'.json'.length);
        return {
          ...parseCase(raw, { area, name, requireExpected: options.requireExpected }),
          file,
        };
      } catch (e) {
        throw new Error(`${file}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    });
}

function parseOutcome(raw: unknown): CaseOutcome {
  if (!isObject(raw)) throw new Error(`'expected' must be an object`);
  const keys = Object.keys(raw);
  if (keys.length !== 1 || (keys[0] !== 'ok' && keys[0] !== 'error')) {
    throw new Error(`'expected' must have exactly one of 'ok' and 'error'`);
  }
  if ('ok' in raw) return { ok: raw['ok'] };
  return { error: parseError(raw['error']) };
}

function parseError(raw: unknown): CaseError {
  if (!isObject(raw)) throw new Error(`'expected.error' must be an object`);
  for (const key of Object.keys(raw)) {
    if (!ERROR_KEYS.has(key)) throw new Error(`unknown property '${key}' of 'expected.error'`);
  }
  const { code, path, issues } = raw;
  if (code !== undefined && typeof code !== 'string') {
    throw new Error(`'expected.error.code' must be a string`);
  }
  if (path !== undefined && typeof path !== 'string') {
    throw new Error(`'expected.error.path' must be a string`);
  }
  if (issues !== undefined && !Array.isArray(issues)) {
    throw new Error(`'expected.error.issues' must be an array`);
  }
  return {
    ...(code === undefined ? {} : { code }),
    ...(path === undefined ? {} : { path }),
    ...(issues === undefined ? {} : { issues: issues.map(parseIssue) }),
  };
}

function parseIssue(raw: unknown): CaseIssue {
  const bad = new Error(`'expected.error.issues' must hold { path, code? }`);
  if (!isObject(raw) || typeof raw['path'] !== 'string') throw bad;
  if (Object.keys(raw).some((key) => !ISSUE_KEYS.has(key))) throw bad;
  const code = raw['code'];
  if (code !== undefined && typeof code !== 'string') throw bad;
  return { path: raw['path'], ...(code === undefined ? {} : { code }) };
}

function parseTolerance(raw: unknown): Partial<Tolerance> {
  if (!isObject(raw)) throw new Error(`'tolerance' must be an object`);
  const tolerance: Partial<Record<keyof Tolerance, number>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!TOLERANCE_KEYS.has(key)) throw new Error(`unknown property '${key}' of 'tolerance'`);
    if (typeof value !== 'number' || !(value >= 0)) {
      throw new Error(`'tolerance.${key}' must be a non-negative number`);
    }
    // The key is one of TOLERANCE_KEYS, checked just above.
    tolerance[key as keyof Tolerance] = value;
  }
  return tolerance;
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
