// The coverage metatest of the shared cases (M38, task 6; spec 13, Sdílené testovací případy):
// the cases are the specification of the C++ core, so what they must cover is checked here, not
// by reading them. The required sets come from the code wherever it has them at runtime
// (OP_VERSION, the feature types of the core, CASE_KINDS, the visibleWhen of the schemas); where a TS union
// is all there is, a `satisfies Record<…, true>` object keeps the list exhaustive at compile time.
// A new op type, feature, error code or constraint kind without a case fails here.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OP_VERSION } from '@/ops';
import type { FeatureErrorData, FeatureStatusData } from '@/remote';
import type { SketchConstraint } from '@/sketch';
import { areaOfKind, CASE_KINDS, loadCases } from './support/case';
import type { Area, LoadedCase } from './support/case';
import { builtInFeatureTypes, builtInSchemas } from './support/schemas';

/**
 * Every FeatureError code. STALE_VERSION is listed (the object must be exhaustive) but not
 * required: a stored document never yields it (spec 13, regen).
 */
const FEATURE_ERROR_CODES = {
  INVALID_PARAMS: true,
  UNRESOLVED_REFERENCE: true,
  KERNEL: true,
  UNKNOWN_TYPE: true,
  STALE_VERSION: false,
} as const satisfies Record<FeatureErrorData['code'], boolean>;

/** Every kind of the status of a feature the core reports. */
const FEATURE_STATUS_KINDS = {
  ok: true,
  warning: true,
  error: true,
  suppressed: true,
  rolledBack: true,
} as const satisfies Record<FeatureStatusData['kind'], boolean>;

/**
 * The codes of the generic validation (validateAgainstSchema and the reference kinds, spec 03).
 * ParamIssue.code is a plain string, so this list follows spec 03 by hand. false = no built-in
 * schema raises it (spec 13, schema.validate), so no case covers it.
 */
const GENERIC_PARAM_ISSUE_CODES: Readonly<Record<string, boolean>> = {
  'param.missing': true,
  'param.unexpected': true,
  'param.wrongType': true,
  'param.notInteger': false,
  'param.belowMin': false,
  'param.atOrBelowMin': true,
  'param.aboveMax': true,
  'param.atOrAboveMax': false,
  'param.unknownOption': true,
  'param.tooFewRefs': true,
  'param.tooManyRefs': true,
  'param.invalidRef': true,
  'param.duplicateRef': true,
};

/** Every kind of SketchConstraint, exhaustive at compile time. */
const CONSTRAINT_KINDS = {
  coincident: true,
  horizontal: true,
  vertical: true,
  parallel: true,
  perpendicular: true,
  equal: true,
  tangent: true,
  pointOnCurve: true,
  midpoint: true,
  hAlign: true,
  vAlign: true,
  symmetric: true,
  fix: true,
  distance: true,
  hDistance: true,
  vDistance: true,
  pointLineDistance: true,
  angle: true,
  radius: true,
  diameter: true,
  offset: true,
} as const satisfies Record<SketchConstraint['kind'], true>;

/** The derived entities of sketch.derived (spec 13): patterns and text. */
const DERIVED_ENTITY_KINDS = ['mirror', 'linearPattern', 'circularPattern', 'text'] as const;

/**
 * The kinds only the C++ core runs (N124): it is the reference implementation of the shared cases.
 * The client keeps the runners of what it runs itself: the handlers of the optimistic mirror
 * (ops.script) and the solver of the sketch.
 */
const ONLY_IN_CPP: ReadonlySet<string> = new Set(
  CASE_KINDS.filter(
    (k) => k === 'ops.upcast' || k === 'ops.replay' || !['ops', 'sketch'].includes(areaOfKind(k)),
  ),
);

const cases: Readonly<Record<Area, readonly LoadedCase[]>> = {
  ops: loadCases('ops', { requireExpected: true }),
  document: loadCases('document', { requireExpected: true }),
  schema: loadCases('schema', { requireExpected: true }),
  regen: loadCases('regen', { requireExpected: true }),
  geometry: loadCases('geometry', { requireExpected: true }),
  sketch: loadCases('sketch', { requireExpected: true }),
};

describe('shared cases coverage', () => {
  it('every kind of CASE_KINDS has a case', () => {
    const covered = new Set(Object.values(cases).flatMap((area) => area.map((c) => c.kind)));
    expect(missing(CASE_KINDS, covered)).toEqual([]);
  });

  it('every kind of CASE_KINDS run in TS has a runner file that handles it', () => {
    const handled = new Set(
      readdirSync(RUNNERS_DIR)
        .filter((entry) => entry.endsWith('.test.ts'))
        .flatMap((entry) => kindsHandledBy(readFileSync(new URL(entry, RUNNERS_DIR), 'utf8'))),
    );
    expect(
      missing(
        CASE_KINDS.filter((k) => !ONLY_IN_CPP.has(k)),
        handled,
      ),
    ).toEqual([]);
  });

  // The scan of a runner file must be able to fail: only a KindRunner key of describeSharedCases.
  it('reads the handled kinds from the describeSharedCases call only', () => {
    const source = [
      "const other = { 'ops.upcast': 1 };",
      "describeSharedCases('regen', { regen: { run } });",
      "describeSharedCases('sketch', {\n  'sketch.solve': {\n    run() {},\n  },\n});",
    ].join('\n');
    expect(kindsHandledBy(source)).toEqual(['regen', 'sketch.solve']);
    expect(kindsHandledBy("const x = { 'ops.upcast': { run } };")).toEqual([]);
  });

  it('every operation type of OP_VERSION has a valid ops.upcast case', () => {
    const covered = new Set(
      ofKind('ops', 'ops.upcast')
        .filter((c) => okOf(c) !== undefined)
        .map((c) => stringAt(c.input, 'operation', 'type')),
    );
    expect(missing(Object.keys(OP_VERSION), covered)).toEqual([]);
  });

  it('every operation type of OP_VERSION is replayed by an ops.replay case', () => {
    const covered = new Set<string>();
    for (const c of ofKind('ops', 'ops.replay')) {
      for (const entry of arrayAt(c.input, 'entries')) collectOpTypes(at(entry, 'op'), covered);
    }
    expect(missing(Object.keys(OP_VERSION), covered)).toEqual([]);
  });

  it('every built-in feature is ok in a regen case', () => {
    const covered = new Set<string>();
    for (const c of ofKind('regen', 'regen')) {
      const types = featureTypes(c);
      for (const [id, status] of Object.entries(recordAt(okOf(c), 'statuses'))) {
        if (at(status, 'kind') === 'ok') covered.add(types.get(id) ?? '');
      }
    }
    expect(missing(builtInFeatureTypes(), covered)).toEqual([]);
  });

  it('every built-in feature has a schema.validate case', () => {
    const covered = new Set(
      ofKind('schema', 'schema.validate').map((c) => stringAt(c.input, 'type')),
    );
    expect(missing(builtInFeatureTypes(), covered)).toEqual([]);
  });

  it('every FeatureError code but STALE_VERSION is a status of a regen case', () => {
    const covered = new Set<string>();
    for (const c of ofKind('regen', 'regen')) {
      for (const status of Object.values(recordAt(okOf(c), 'statuses'))) {
        if (at(status, 'kind') === 'error') covered.add(stringAt(status, 'code'));
      }
    }
    expect(missing(required(FEATURE_ERROR_CODES), covered)).toEqual([]);
  });

  it('every kind of the status of a feature is a status of a regen case', () => {
    const covered = new Set<string>();
    for (const c of ofKind('regen', 'regen')) {
      for (const status of Object.values(recordAt(okOf(c), 'statuses'))) {
        covered.add(stringAt(status, 'kind'));
      }
    }
    expect(missing(required(FEATURE_STATUS_KINDS), covered)).toEqual([]);
  });

  it('every ParamIssue code the built-in schemas raise has a schema.validate case', () => {
    const covered = new Set<string>();
    for (const c of ofKind('schema', 'schema.validate')) {
      for (const issue of arrayAt(okOf(c), 'issues')) covered.add(stringAt(issue, 'code'));
    }
    expect(missing(required(GENERIC_PARAM_ISSUE_CODES), covered)).toEqual([]);
  });

  it('every geometry kind has an ok and an error case', () => {
    const geometryKinds = CASE_KINDS.filter((k) => k.startsWith('geometry.'));
    const outcomes = new Set(
      cases.geometry.map((c) => `${c.kind} ${okOf(c) === undefined ? 'error' : 'ok'}`),
    );
    const wanted = geometryKinds.flatMap((k) => [`${k} ok`, `${k} error`]);
    expect(missing(wanted, outcomes)).toEqual([]);
  });

  describe('sketch.solve', () => {
    const solves = ofKind('sketch', 'sketch.solve');

    it('has a fully defined case (dof 0)', () => {
      expect(solves.some((c) => at(okOf(c), 'dof') === 0)).toBe(true);
    });

    it('has an underdefined case (dof > 0)', () => {
      expect(solves.some((c) => (numberAt(okOf(c), 'dof') ?? 0) > 0)).toBe(true);
    });

    it('has a conflict case', () => {
      expect(solves.some((c) => at(okOf(c), 'status') === 'conflict')).toBe(true);
    });

    it('has a case with a redundant constraint', () => {
      expect(solves.some((c) => arrayAt(okOf(c), 'redundant').length > 0)).toBe(true);
    });

    it('has a drag case', () => {
      expect(solves.some((c) => at(c.input, 'drag') !== undefined)).toBe(true);
    });

    it('has a case of every constraint kind', () => {
      const covered = new Set(
        solves.flatMap((c) => arrayAt(c.input, 'constraints').map((k) => stringAt(k, 'kind'))),
      );
      expect(missing(Object.keys(CONSTRAINT_KINDS), covered)).toEqual([]);
    });
  });

  it('sketch.derived has a case of every derived entity kind', () => {
    const covered = new Set(
      ofKind('sketch', 'sketch.derived').flatMap((c) =>
        arrayAt(c.input, 'entities').map((e) => stringAt(e, 'kind')),
      ),
    );
    expect(missing(DERIVED_ENTITY_KINDS, covered)).toEqual([]);
  });

  it('every visibleWhen of a built-in schema has a visible, hidden, missing and wrong-type case', () => {
    const wanted = builtInSchemas()
      .all()
      .flatMap((schema) =>
        Object.entries(schema.params)
          .filter(([, spec]) => spec.visibleWhen !== undefined)
          .flatMap(([param]) => VISIBILITY_VARIANTS.map((v) => `${schema.type}.${param} ${v}`)),
      );
    expect(wanted).not.toEqual([]);
    const covered = new Set(visibilityVariants(ofKind('schema', 'schema.visibleWhen')));
    expect(missing(wanted, covered)).toEqual([]);
  });

  // The detection of the variants must be able to fail: a case of each kind alone covers only it.
  describe('visibleWhen variants', () => {
    /** A recorded visibleWhen case of extrude.flip with the params and the visibility. */
    function aCase(name: string, params: Readonly<Record<string, unknown>>, visible: boolean) {
      return {
        area: 'schema',
        name,
        kind: 'schema.visibleWhen',
        description: name,
        input: { type: 'extrude', param: 'flip', params },
        expected: { ok: { visible } },
        file: `${name}.json`,
      } as const satisfies LoadedCase;
    }
    const visible = aCase('visible', { endType: 'blind', operation: 'new' }, true);
    const hidden = aCase('hidden', { endType: 'symmetric' }, false);

    it('tells visible and hidden by the recorded visibility', () => {
      expect(visibilityVariants([visible, hidden])).toEqual([
        'extrude.flip visible',
        'extrude.flip hidden',
      ]);
    });

    it('takes params without any key as missing', () => {
      expect(visibilityVariants([visible, aCase('m', {}, false)])).toContain(
        'extrude.flip missing',
      );
    });

    it('takes a single param of another JSON type than in the visible cases as wrong-type', () => {
      for (const value of [true, 0, null, ['blind'], { v: 'blind' }]) {
        expect(visibilityVariants([visible, aCase('w', { endType: value }, false)])).toContain(
          'extrude.flip wrong-type',
        );
      }
    });

    it('does not take a value of the right type, more params or no visible case as wrong-type', () => {
      const variants = [
        ...visibilityVariants([visible, aCase('w', { endType: 'upToFace' }, false)]),
        ...visibilityVariants([visible, aCase('w', { endType: true, operation: 'new' }, false)]),
        ...visibilityVariants([hidden, aCase('w', { endType: true }, false)]),
      ];
      expect(variants).not.toContain('extrude.flip wrong-type');
    });
  });
});

/** The folder of the runner files, next to this metatest. */
const RUNNERS_DIR = new URL('./', import.meta.url);

/**
 * The kinds a runner file hands to describeSharedCases: the keys of CASE_KINDS that open a
 * KindRunner object (`'sketch.solve': {` or `regen: {`) after a describeSharedCases( call. The
 * runners are describe blocks of other test files, so their source is all there is to read.
 */
function kindsHandledBy(source: string): readonly string[] {
  const start = source.indexOf('describeSharedCases(');
  if (start < 0) return [];
  const calls = source.slice(start);
  return CASE_KINDS.filter((kind) =>
    new RegExp(`(?:^|[\\s{,])(['"]?)${kind.replace('.', '\\.')}\\1\\s*:\\s*\\{`, 'm').test(calls),
  );
}

/** What every visibleWhen param needs a case of (spec 14, VisibleWhen; spec 13). */
const VISIBILITY_VARIANTS = ['visible', 'hidden', 'missing', 'wrong-type'] as const;

/**
 * `<type>.<param> <variant>` of every visibleWhen case that is one, by its data and not by its
 * file name. visible and hidden by the recorded visibility. missing: no param at all, so the
 * controlling param is surely absent (the predicates are functions, so which param controls
 * cannot be read from the schema). wrong-type: a single param whose JSON type differs from its
 * type in every visible case of the same param that has it; a visible case always holds the
 * controlling value in the type the predicate compares to (another type hides, spec 14), and
 * there must be such a case, so a value merely outside the options does not count.
 */
function visibilityVariants(visibleWhenCases: readonly LoadedCase[]): readonly string[] {
  const target = (c: LoadedCase) => `${stringAt(c.input, 'type')}.${stringAt(c.input, 'param')}`;
  const visibleCases = visibleWhenCases.filter((c) => at(okOf(c), 'visible') === true);
  return visibleWhenCases.flatMap((c) => {
    const variants = [`${target(c)} ${at(okOf(c), 'visible') === true ? 'visible' : 'hidden'}`];
    const params = Object.entries(recordAt(c.input, 'params'));
    if (params.length === 0) variants.push(`${target(c)} missing`);
    const [single] = params;
    if (params.length === 1 && single !== undefined) {
      const [key, value] = single;
      const rightTypes = visibleCases
        .filter((v) => target(v) === target(c) && key in recordAt(v.input, 'params'))
        .map((v) => jsonType(recordAt(v.input, 'params')[key]));
      if (rightTypes.length > 0 && !rightTypes.includes(jsonType(value))) {
        variants.push(`${target(c)} wrong-type`);
      }
    }
    return variants;
  });
}

/** The JSON type of a value: null and array apart from object. */
function jsonType(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

function ofKind(area: Area, kind: LoadedCase['kind']): readonly LoadedCase[] {
  return cases[area].filter((c) => c.kind === kind);
}

/** The ok output of a case, undefined for an error case. */
function okOf(c: LoadedCase): unknown {
  return c.expected !== undefined && 'ok' in c.expected ? c.expected.ok : undefined;
}

/** The keys marked true: the codes a case must cover. */
function required(codes: Readonly<Record<string, boolean>>): readonly string[] {
  return Object.entries(codes)
    .filter(([, isRequired]) => isRequired)
    .map(([code]) => code);
}

/** The wanted values without a case, in the order of wanted (an empty list = covered). */
function missing(wanted: readonly string[], covered: ReadonlySet<string>): readonly string[] {
  return wanted.filter((w) => !covered.has(w));
}

/** The feature id → type of the document of a regen case. */
function featureTypes(c: LoadedCase): ReadonlyMap<string, string> {
  const features = arrayAt(c.input, 'document', 'studio', 'features');
  return new Map(features.map((f) => [stringAt(f, 'id'), stringAt(f, 'type')]));
}

/** The type of an operation and of the operations nested in a batch. */
function collectOpTypes(op: unknown, into: Set<string>): void {
  const type = stringAt(op, 'type');
  into.add(type);
  if (type === 'batch') for (const inner of arrayAt(op, 'ops')) collectOpTypes(inner, into);
}

/** The value at a path of JSON keys, undefined when a step is not an object. */
function at(value: unknown, ...path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as Readonly<Record<string, unknown>>)[key]; // a non-array object, by key
  }
  return current;
}

function stringAt(value: unknown, ...path: readonly string[]): string {
  const found = at(value, ...path);
  return typeof found === 'string' ? found : '';
}

function numberAt(value: unknown, ...path: readonly string[]): number | undefined {
  const found = at(value, ...path);
  return typeof found === 'number' ? found : undefined;
}

function arrayAt(value: unknown, ...path: readonly string[]): readonly unknown[] {
  const found = at(value, ...path);
  // Array.isArray narrows to any[]; the elements are read as unknown.
  return Array.isArray(found) ? (found as readonly unknown[]) : [];
}

function recordAt(value: unknown, ...path: readonly string[]): Readonly<Record<string, unknown>> {
  const found = at(value, ...path);
  return typeof found === 'object' && found !== null && !Array.isArray(found)
    ? (found as Readonly<Record<string, unknown>>) // a non-array object, read by key
    : {};
}
