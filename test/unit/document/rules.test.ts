import { describe, expect, it } from 'vitest';
import { checkParamRules } from '@/document/rules';
import type { ParamRule } from '@/document/rules';
import type { ParamIssue, ParamSchema } from '@/document/schema';
import { validateAgainstSchema } from '@/document/validate';

// checkParamRules (M49): the declarative rule disjointRefs over a small test schema; the same cases
// as server/test/document/rules_test.cpp of the core.

const body = (id: string) => ({ kind: 'body', body: id });
const topo = (bodyId: string, name: string) => ({ kind: 'topo', body: bodyId, name });

const disjoint = (param: string, other: string): ParamRule => ({
  kind: 'disjointRefs',
  code: 'test.same',
  param,
  other,
});

/** targets, tools (bodies), from, to (topo), hidden (bodies, shown only with mode 'both'). */
const SCHEMA: ParamSchema = {
  targets: { kind: 'bodies', label: 't' },
  tools: { kind: 'bodies', label: 'o' },
  from: { kind: 'topo', label: 'f', entity: 'edge' },
  to: { kind: 'topo', label: 'g', entity: 'edge' },
  mode: {
    kind: 'enum',
    label: 'm',
    default: 'one',
    options: [
      { value: 'one', label: 'm.one' },
      { value: 'both', label: 'm.both' },
    ],
  },
  hidden: { kind: 'bodies', label: 'h', visibleWhen: (p) => p['mode'] === 'both' },
  axis: { kind: 'axis', label: 'a' },
};

/** validateAgainstSchema + checkParamRules, the way a schema of the client validates. */
function validate(rules: readonly ParamRule[], raw: unknown): readonly ParamIssue[] {
  const issues = validateAgainstSchema(SCHEMA, raw);
  return [...issues, ...checkParamRules(SCHEMA, rules, raw, issues)];
}

function params(
  targets: readonly unknown[],
  tools: readonly unknown[],
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    targets,
    tools,
    from: [],
    to: [],
    mode: 'one',
    axis: { kind: 'axis', axis: 'origin/axis:x' },
    ...extra,
  };
}

describe('checkParamRules – disjointRefs', () => {
  it('reports the first item of param that is also in other at its index', () => {
    expect(
      validate(
        [disjoint('tools', 'targets')],
        params([body('a/body'), body('b/body')], [body('c/body'), body('b/body'), body('a/body')]),
      ),
    ).toEqual([{ param: 'tools', code: 'test.same', params: { index: 1 } }]);
  });

  it('reports nothing for disjoint lists', () => {
    expect(
      validate([disjoint('tools', 'targets')], params([body('a/body')], [body('a/body:1')])),
    ).toEqual([]);
  });

  it('compares topo references by body and name', () => {
    const from = [topo('a/body', 'e1'), topo('a/body', 'e2')];
    expect(
      validate(
        [disjoint('to', 'from')],
        params([], [], { from, to: [topo('a/body', 'e2'), topo('b/body', 'e1')] }),
      ),
    ).toEqual([{ param: 'to', code: 'test.same', params: { index: 0 } }]);
    expect(
      validate(
        [disjoint('to', 'from')],
        params([], [], { from, to: [topo('b/body', 'e1'), topo('a/body', 'e3')] }),
      ),
    ).toEqual([]);
  });

  it('ignores extra fields of the references', () => {
    const tagged = { ...body('a/body'), note: 'x' };
    expect(
      validate([disjoint('tools', 'targets')], params([body('a/body')], [tagged])).map(
        (i) => i.code,
      ),
    ).toEqual(['test.same']);
  });

  it('skips a hidden param', () => {
    const p = params([body('a/body')], [], { hidden: [body('a/body')] });
    expect(validate([disjoint('hidden', 'targets')], p)).toEqual([]);
    expect(validate([disjoint('hidden', 'targets')], { ...p, mode: 'both' })).toEqual([
      { param: 'hidden', code: 'test.same', params: { index: 0 } },
    ]);
  });

  it('skips when the generic checks reported other or param', () => {
    // A broken item in other: only the generic issue.
    expect(
      validate([disjoint('tools', 'targets')], params([body('a/body'), 3], [body('a/body')])),
    ).toEqual([{ param: 'targets', code: 'param.invalidRef', params: { index: 1 } }]);
    // A duplicate in param.
    expect(
      validate(
        [disjoint('tools', 'targets')],
        params([body('a/body')], [body('a/body'), body('a/body')]),
      ).map((i) => i.code),
    ).toEqual(['param.duplicateRef']);
  });

  it('skips every rule when the params object was reported', () => {
    const p = params([body('a/body')], [body('a/body')]);
    expect(
      checkParamRules(SCHEMA, [disjoint('tools', 'targets')], p, [
        { param: '', code: 'param.wrongType' },
      ]),
    ).toEqual([]);
  });

  it('ignores issues at other params', () => {
    expect(
      validate(
        [disjoint('tools', 'targets')],
        params([body('a/body')], [body('a/body')], { extra: 1 }),
      ).map((i) => i.code),
    ).toEqual(['param.unexpected', 'test.same']);
  });

  it('reports nothing when the params are not an object', () => {
    for (const raw of [null, undefined, 3, [], 'x']) {
      expect(checkParamRules(SCHEMA, [disjoint('tools', 'targets')], raw, [])).toEqual([]);
    }
  });

  it('reports every rule in order', () => {
    const p = params([body('a/body')], [body('a/body')], {
      from: [topo('a/body', 'e1')],
      to: [topo('a/body', 'e1')],
    });
    expect(
      validate([disjoint('to', 'from'), disjoint('tools', 'targets')], p).map((i) => i.param),
    ).toEqual(['to', 'tools']);
  });

  it('reports nothing for a rule over an unknown param, an axis or a plain value', () => {
    const p = params([body('a/body')], [body('a/body')]);
    for (const rule of [
      disjoint('tools', 'bodies'),
      disjoint('axis', 'targets'),
      disjoint('tools', 'mode'),
    ]) {
      expect(checkParamRules(SCHEMA, [rule], p, validateAgainstSchema(SCHEMA, p))).toEqual([]);
    }
  });
});
