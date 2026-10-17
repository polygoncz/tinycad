// The common runner of shared cases (spec 13, Soubory a běh): one `it` per case of an area whose
// kind the runner file handles; it compares the TS output with expected, or with CASES_RECORD=1
// writes it into expected. A runner file supplies one KindRunner per kind it handles, so several
// runner files may share an area (schema.visibleWhen and schema.validate).

import { describe, expect, it } from 'vitest';
import { loadCases } from './case';
import type { Area, CaseKind, CaseOutcome, LoadedCase, Tolerance } from './case';
import { firstDifference, resolveTolerance } from './compare';
import { isRecordMode, recordExpected } from './record';

/** What a KindRunner gets next to the input. */
export interface KindContext {
  /** The case being run, with its file, description and source. */
  readonly sharedCase: LoadedCase;
  /** The defaults of spec 13 overridden by the tolerance of the case. */
  readonly tolerance: Tolerance;
}

/** How a runner file runs one kind of case. */
export interface KindRunner {
  /**
   * Runs the TS domain on the input of the case. Ordering the domain does not define must already
   * be sorted here (the rule is in the table of kinds of spec 13), because the same output is both
   * recorded and compared. The output goes through JSON (undefined keys drop out) before either.
   * Domain errors are returned as `{ error }` (code and path, never the message); a throw fails
   * the case.
   */
  readonly run: (input: unknown, context: KindContext) => CaseOutcome | Promise<CaseOutcome>;
  /**
   * Replaces the generic comparison of the outcomes (firstDifference over the whole outcome) when
   * a kind checks something else than equality, e.g. the fixed point of sketch.solve with dof > 0
   * (spec 13, Q109). Returns the first difference as a message, undefined when the case passes.
   * Not called in the record mode.
   */
  readonly verify?: (
    expected: CaseOutcome,
    actual: CaseOutcome,
    context: KindContext,
  ) => string | undefined | Promise<string | undefined>;
}

/** The runners of the kinds a runner file handles. */
export type KindRunners = Partial<Readonly<Record<CaseKind, KindRunner>>>;

export interface SharedCasesOptions {
  /** The folder with the area folders; test/shared-cases/ by default (tests of the support). */
  readonly root?: string;
  /** The timeout of one case in ms (slow kinds such as regen over OCCT). */
  readonly timeout?: number;
}

/**
 * Declares a describe with one `it` per case of the area whose kind has a runner here. Loading
 * fails (an unknown kind or property, a broken file) at collection, so `npm run check` fails too.
 * Cases of other kinds of the area belong to other runner files and are left out.
 */
export function describeSharedCases(
  area: Area,
  runners: KindRunners,
  options: SharedCasesOptions = {},
): void {
  const record = isRecordMode();
  const cases = loadCases(area, {
    requireExpected: !record,
    ...(options.root === undefined ? {} : { root: options.root }),
  }).filter((c) => runners[c.kind] !== undefined);
  const kinds = Object.keys(runners).join(', ');
  if (cases.length === 0) throw new Error(`No shared cases of ${kinds} in the area '${area}'`);

  describe(`shared cases ${area} (${kinds})`, () => {
    for (const sharedCase of cases) {
      it(
        `${sharedCase.name}: ${sharedCase.description}`,
        async () => {
          await runCase(sharedCase, runners, record);
        },
        options.timeout,
      );
    }
  });
}

async function runCase(sharedCase: LoadedCase, runners: KindRunners, record: boolean) {
  const runner = runners[sharedCase.kind];
  if (runner === undefined) throw new Error(`No runner of '${sharedCase.kind}'`);
  const context: KindContext = {
    sharedCase,
    tolerance: resolveTolerance(sharedCase.tolerance),
  };
  const actual = asJson(await runner.run(sharedCase.input, context));

  if (record) {
    await recordExpected(sharedCase.file, actual);
    return;
  }
  const { expected } = sharedCase;
  if (expected === undefined) throw new Error(`${sharedCase.file}: 'expected' is missing`);
  const difference =
    runner.verify === undefined
      ? firstDifference(expected, actual, context.tolerance)
      : await runner.verify(expected, actual, context);
  if (difference !== undefined) expect.fail(`${sharedCase.file}\n${difference}`);
}

/** The outcome as it would be read back from the file: through JSON. */
function asJson(outcome: CaseOutcome): CaseOutcome {
  // JSON.parse of a stringified CaseOutcome is a CaseOutcome without undefined keys.
  return JSON.parse(JSON.stringify(outcome)) as CaseOutcome;
}
