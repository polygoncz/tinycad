// The runner of the shared cases sketch.solve and sketch.derived (spec 13, Druhy případů; Q109):
// the planegcs solver in the calling thread on a SolveInput, and the derived curves of a sketch
// (patternCopies, textCurves, regionCurves). A sketch.solve case compares status, dof and the
// sorted conflicting and redundant ids always, the whole entities only at dof 0; at dof > 0 the
// entities without their numbers and the dragged point, and the solved entities must be a fixed
// point of the solver (they go to the solver again and must not move).

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@/core';
import { parseSketchData, patternCopies, regionCurves, textCurves } from '@/sketch';
import type { SketchData, SketchEntityId, SolveInput } from '@/sketch';
import { createInThreadPlanegcsSolver } from '@/solver-planegcs/testing';
import { loadCases } from './support/case';
import type { CaseOutcome, Tolerance } from './support/case';
import { DEFAULT_TOLERANCE, firstDifference } from './support/compare';
import { asJson, describeSharedCases } from './support/runner';

const solver = createInThreadPlanegcsSolver();

describeSharedCases(
  'sketch',
  {
    'sketch.solve': {
      async run(input) {
        return { ok: await solveOutput(solveInput(input)) };
      },
      verify(expected, actual, context) {
        return verifySolve(
          expected,
          actual,
          solveInput(context.sharedCase.input),
          context.tolerance,
        );
      },
    },
    'sketch.derived': {
      run(input) {
        const data = sketchData(input, ['entities', 'constraints']);
        return {
          ok: {
            copies: patternCopies(data),
            textCurves: textCurves(data),
            regionCurves: regionCurves(data),
          },
        };
      },
    },
  },
  // The first case loads the planegcs WASM.
  { timeout: 30_000 },
);

/** The output of sketch.solve: the SolveResult with conflicting and redundant sorted. */
async function solveOutput(input: SolveInput) {
  const result = await solver.solve(input);
  return {
    status: result.status,
    dof: result.dof,
    // The solver reports them in no defined order (spec 13: lists sorted).
    conflicting: [...result.conflicting].sort(),
    redundant: [...result.redundant].sort(),
    entities: result.entities,
  };
}

/**
 * The comparison of sketch.solve (spec 13, Q109): at dof 0 (or a failed solve) the whole output;
 * otherwise status, dof, conflicting and redundant, whether there are entities, the entities
 * without their numbers, the dragged point of a drag case within `length`, and the fixed point –
 * the actual entities solved again without the drag must stay within `length` and keep the dof.
 * The other recorded coordinates of such a case are not compared.
 */
async function verifySolve(
  expected: CaseOutcome,
  actual: CaseOutcome,
  input: SolveInput,
  tolerance: Tolerance,
): Promise<string | undefined> {
  if (!('ok' in expected) || !('ok' in actual)) return firstDifference(expected, actual, tolerance);
  const want = asRecord(expected.ok);
  const got = asRecord(actual.ok);
  if (want['dof'] === 0 || want['dof'] === null)
    return firstDifference(expected, actual, tolerance);

  const { entities: wantEntities, ...wantRest } = want;
  const { entities: gotEntities, ...gotRest } = got;
  const difference = firstDifference({ ok: wantRest }, { ok: gotRest }, tolerance);
  if (difference !== undefined) return difference;
  if ((wantEntities === null) !== (gotEntities === null)) {
    return `expected.ok.entities: ${wantEntities === null ? 'null' : 'entities'} ≠ ${gotEntities === null ? 'null' : 'entities'}`;
  }
  if (gotEntities === null || gotEntities === undefined) return undefined;
  const structure = structureDifference(wantEntities, gotEntities);
  if (structure !== undefined) return structure;
  const dragged = draggedPointDifference(wantEntities, gotEntities, input, tolerance);
  if (dragged !== undefined) return dragged;
  return fixedPointDifference(
    sketchData({ entities: gotEntities, constraints: input.constraints }),
    got['dof'],
    tolerance,
  );
}

/**
 * The entities compared with every number ignored (spec 13, Q109): ids, kinds, references,
 * strings and booleans exactly, the same keys and array lengths, a number only against a number.
 * firstDifference with unlimited tolerances does exactly that (the entities of a sketch have no
 * 'volume' key, the one key compared relatively).
 */
function structureDifference(expected: unknown, actual: unknown): string | undefined {
  const anyNumber: Tolerance = { length: Infinity, angle: Infinity, relative: Infinity };
  return firstDifference(expected, actual, anyNumber, 'expected.ok.entities');
}

/**
 * The dragged point of a case with drag against its recorded coordinates within `length`
 * (spec 13, Q109): where the drag puts it does not depend on the free degrees of freedom.
 */
function draggedPointDifference(
  expected: unknown,
  actual: unknown,
  input: SolveInput,
  tolerance: Tolerance,
): string | undefined {
  if (input.drag === undefined) return undefined;
  const id = input.drag.point;
  const index = Array.isArray(expected)
    ? expected.findIndex((e: unknown) => asRecord(e)['id'] === id)
    : -1;
  if (index < 0) return `expected.ok.entities: no dragged point '${id}'`;
  // The structure matched already, so the actual entity sits at the same index.
  const at = (entities: unknown) => (Array.isArray(entities) ? asRecord(entities[index]) : {});
  return firstDifference(
    at(expected),
    at(actual),
    tolerance,
    `expected.ok.entities[${String(index)}]`,
  );
}

/** Why the solved data is not a fixed point of the solver, or undefined when it is. */
async function fixedPointDifference(
  solved: SketchData,
  dof: unknown,
  tolerance: Tolerance,
): Promise<string | undefined> {
  const again = await solveOutput(solved);
  if (again.status !== 'ok') return `fixed point: the second solve is '${again.status}'`;
  if (again.dof !== dof) return `fixed point: dof ${String(dof)} ≠ ${String(again.dof)}`;
  const moved = firstDifference(solved.entities, again.entities, tolerance, 'fixedPoint.entities');
  return moved === undefined ? undefined : `fixed point: ${moved}`;
}

/** The SolveInput of a case: SketchData through the trusted parser plus an optional drag. */
function solveInput(input: unknown): SolveInput {
  const data = sketchData(input, ['entities', 'constraints', 'drag']);
  const drag = asRecord(input)['drag'];
  if (drag === undefined) return data;
  const { point, to } = asRecord(drag);
  if (typeof point !== 'string' || !isVec2(to)) {
    throw new Error('input.drag must be { point: string, to: [x, y] }');
  }
  // The dragged point need not be in the sketch (a failed solve), so it is branded on its own.
  const branded = parseSketchData([{ kind: 'point', id: point, x: 0, y: 0 }], []);
  const id: SketchEntityId | undefined = branded.ok ? branded.value.entities[0]?.id : undefined;
  if (id === undefined) throw new Error(`input.drag.point '${point}' is not a valid id`);
  return { ...data, drag: { point: id, to } };
}

/** { entities, constraints } through parseSketchData; a broken sketch is a broken case. */
function sketchData(
  input: unknown,
  keys: readonly string[] = ['entities', 'constraints'],
): SketchData {
  const record = asRecord(input);
  const unknown = Object.keys(record).find((key) => !keys.includes(key));
  if (unknown !== undefined) throw new Error(`unknown property '${unknown}' of the input`);
  const parsed = parseSketchData(record['entities'], record['constraints']);
  if (!parsed.ok) throw new Error(`invalid sketch: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected a JSON object, got ${JSON.stringify(value)}`);
  }
  // A non-null, non-array object read field by field.
  return value as Readonly<Record<string, unknown>>;
}

function isVec2(value: unknown): value is Vec2 {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

// The comparison itself must be able to fail (spec 13, Q109): a fixed point that is not one, a
// different dof, a dropped field or reference, an ignored drag, a moved coordinate at dof 0.
// Over a recorded case, with the real solver.
describe('sketch.solve comparison', () => {
  const cases = loadCases('sketch', { requireExpected: false });

  /** The input and the fresh TS outcome of a recorded case. */
  async function caseAt(name: string): Promise<{ input: SolveInput; outcome: CaseOutcome }> {
    const found = cases.find((c) => c.name === name);
    if (found === undefined) throw new Error(`no case ${name}`);
    const input = solveInput(found.input);
    // Through JSON as the runner does it: the comparison sees what a file would hold.
    const outcome = asJson({ ok: await solveOutput(input) });
    return { input, outcome };
  }

  /** The outcome with its output changed by `change`. */
  function changed(
    outcome: CaseOutcome,
    change: (ok: Record<string, unknown>) => Record<string, unknown>,
  ): CaseOutcome {
    return { ok: change({ ...asRecord('ok' in outcome ? outcome.ok : undefined) }) };
  }

  /** The entities of an output with point `id` moved to [x, y]. */
  function withPoint(ok: Record<string, unknown>, id: string, x: number, y: number) {
    const entities = ok['entities'];
    if (!Array.isArray(entities)) throw new Error('no entities');
    return {
      ...ok,
      entities: entities.map((e: unknown) =>
        asRecord(e)['id'] === id ? { ...asRecord(e), x, y } : e,
      ),
    };
  }

  it('passes an underdefined case against itself (dof 4)', async () => {
    const { input, outcome } = await caseAt('solve-rectangle-free');
    expect(asRecord('ok' in outcome ? outcome.ok : undefined)['dof']).toBe(4);
    expect(await verifySolve(outcome, outcome, input, DEFAULT_TOLERANCE)).toBeUndefined();
  });

  it('ignores the other recorded coordinates at dof > 0', async () => {
    const { input, outcome } = await caseAt('solve-rectangle-free');
    // The whole rectangle moved: another valid solution of the same sketch.
    const shifted = changed(outcome, (ok) => withPoint(ok, 'a', 100, 100));
    expect(await verifySolve(shifted, outcome, input, DEFAULT_TOLERANCE)).toBeUndefined();
  });

  it('fails when the solved entities violate a constraint (not a fixed point)', async () => {
    const { input, outcome } = await caseAt('solve-rectangle-free');
    // b lifted off the horizontal side ab: the second solve moves it back.
    const broken = changed(outcome, (ok) => withPoint(ok, 'b', 10, 1));
    const difference = await verifySolve(outcome, broken, input, DEFAULT_TOLERANCE);
    expect(difference).toMatch(/^fixed point: fixedPoint\.entities\[\d\]\.[xy]: /);
  });

  it('fails on a different dof', async () => {
    const { input, outcome } = await caseAt('solve-rectangle-free');
    const other = changed(outcome, (ok) => ({ ...ok, dof: 3 }));
    expect(await verifySolve(outcome, other, input, DEFAULT_TOLERANCE)).toBe(
      'expected.ok.dof: 4 ≠ 3',
    );
  });

  it('fails on missing entities', async () => {
    const { input, outcome } = await caseAt('solve-rectangle-free');
    const other = changed(outcome, (ok) => ({ ...ok, entities: null }));
    expect(await verifySolve(outcome, other, input, DEFAULT_TOLERANCE)).toBe(
      'expected.ok.entities: entities ≠ null',
    );
  });

  it('fails on an entity without one of its fields at dof > 0', async () => {
    const { input, outcome } = await caseAt('solve-rectangle-free');
    const dropped = changed(outcome, (ok) => {
      const entities = ok['entities'];
      if (!Array.isArray(entities)) throw new Error('no entities');
      return {
        ...ok,
        entities: entities.map((e: unknown) => {
          if (asRecord(e)['id'] !== 'ab') return e;
          return Object.fromEntries(Object.entries(asRecord(e)).filter(([key]) => key !== 'p2'));
        }),
      };
    });
    expect(await verifySolve(outcome, dropped, input, DEFAULT_TOLERANCE)).toBe(
      'expected.ok.entities[4].p2: missing in the actual value',
    );
  });

  it('fails on a different reference at dof > 0', async () => {
    const { input, outcome } = await caseAt('solve-rectangle-free');
    const other = changed(outcome, (ok) => {
      const entities = ok['entities'];
      if (!Array.isArray(entities)) throw new Error('no entities');
      return {
        ...ok,
        entities: entities.map((e: unknown) =>
          asRecord(e)['id'] === 'ab' ? { ...asRecord(e), p2: 'c' } : e,
        ),
      };
    });
    expect(await verifySolve(outcome, other, input, DEFAULT_TOLERANCE)).toBe(
      'expected.ok.entities[4].p2: "b" ≠ "c"',
    );
  });

  it('passes a drag case against itself (dof 1)', async () => {
    const { input, outcome } = await caseAt('solve-drag-free-corner');
    expect(asRecord('ok' in outcome ? outcome.ok : undefined)['dof']).toBe(1);
    expect(await verifySolve(outcome, outcome, input, DEFAULT_TOLERANCE)).toBeUndefined();
  });

  it('fails when the solver ignores the drag (the dragged point is compared)', async () => {
    const { input, outcome } = await caseAt('solve-drag-free-corner');
    // A solver without the drag still gives a fixed point with the same dof, but c stays put.
    const withoutDrag: SolveInput = { entities: input.entities, constraints: input.constraints };
    const undragged = asJson({ ok: await solveOutput(withoutDrag) });
    expect(await verifySolve(outcome, undragged, input, DEFAULT_TOLERANCE)).toMatch(
      /^expected\.ok\.entities\[2\]\.[xy]: /,
    );
  });

  it('compares the dragged point within length only', async () => {
    const { input, outcome } = await caseAt('solve-drag-free-corner');
    const near = changed(outcome, (ok) => withPoint(ok, 'c', 10 + 1e-7, 8));
    const far = changed(outcome, (ok) => withPoint(ok, 'c', 10 + 1e-5, 8));
    expect(await verifySolve(outcome, near, input, DEFAULT_TOLERANCE)).toBeUndefined();
    expect(await verifySolve(outcome, far, input, DEFAULT_TOLERANCE)).toBe(
      'expected.ok.entities[2].x: 10 ≠ 10.00001',
    );
  });

  it('compares the coordinates at dof 0', async () => {
    const { input, outcome } = await caseAt('solve-rectangle-fully-defined');
    const moved = changed(outcome, (ok) => withPoint(ok, 'c', 10, 5.001));
    expect(await verifySolve(outcome, moved, input, DEFAULT_TOLERANCE)).toBe(
      'expected.ok.entities[2].y: 5 ≠ 5.001',
    );
  });
});
