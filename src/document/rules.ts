import { isRefParamSpec, refKeyOf } from './ref-kinds';
import { isParamVisible } from './schema';
import type { ParamIssue, ParamSchema, ParamSpec, RefParamSpec } from './schema';

// The declarative rules of a feature type beyond the generic checks (spec 03 "Vlastní pravidla",
// M49, N148): the mirror of param_rule.hpp and rules.cpp of the core. The server sends them in
// FeatureTypeDescriptor.rules, so the feature dialog reports the same ParamIssue code at the field
// before the change is sent; the server still decides. The shared cases schema.validate keep the
// two languages equal (spec 13).

/**
 * A rule as data. disjointRefs: no reference of the list `param` may also be in the list `other`
 * (the same reference by the key of param.duplicateRef); one issue { param, code, { index } } at
 * the first such item of `param`, only when both are visible and passed the generic checks.
 */
export interface ParamRule {
  readonly kind: 'disjointRefs';
  /** ParamIssue.code and the translation key, 'boolean.sameBody'. */
  readonly code: string;
  /** The param the issue is reported at. */
  readonly param: string;
  /** The other reference list. */
  readonly other: string;
}

/**
 * The issues of the rules, in their order; `issues` = validateAgainstSchema(schema, params) (a
 * rule skips params the generic checks reported). Only the new issues. Never throws, whatever
 * `params` is; a rule over a param that is not a reference list of the schema reports nothing.
 */
export function checkParamRules(
  schema: ParamSchema,
  rules: readonly ParamRule[],
  params: unknown,
  issues: readonly ParamIssue[],
): readonly ParamIssue[] {
  if (!isRecord(params)) return [];
  const found: ParamIssue[] = [];
  for (const rule of rules) {
    const paramSpec = listSpecOf(schema, rule.param);
    const otherSpec = listSpecOf(schema, rule.other);
    // The core registry admits only rules over reference lists of the schema; stay total anyway.
    if (paramSpec === undefined || otherSpec === undefined) continue;
    if (!isParamVisible(paramSpec, params) || !isParamVisible(otherSpec, params)) continue;
    if (reported(issues, rule)) continue;
    const issue = RULE_CHECKS[rule.kind](paramSpec, otherSpec, rule, params);
    if (issue !== undefined) found.push(issue);
  }
  return found;
}

/** The check of one kind of rule over the specs of `param` and `other`. */
type RuleCheck = (
  paramSpec: RefParamSpec,
  otherSpec: RefParamSpec,
  rule: ParamRule,
  params: Readonly<Record<string, unknown>>,
) => ParamIssue | undefined;

/**
 * disjointRefs: the issue at the first item of `param` whose key is also in `other`. Both values
 * passed the generic checks (arrays of valid references); a value that is not an array anyway
 * counts as empty.
 */
function checkDisjointRefs(
  paramSpec: RefParamSpec,
  otherSpec: RefParamSpec,
  rule: ParamRule,
  params: Readonly<Record<string, unknown>>,
): ParamIssue | undefined {
  const others = new Set(itemsOf(params[rule.other]).map((item) => refKeyOf(otherSpec, item)));
  const index = itemsOf(params[rule.param]).findIndex((item) =>
    others.has(refKeyOf(paramSpec, item)),
  );
  return index === -1 ? undefined : { param: rule.param, code: rule.code, params: { index } };
}

/**
 * One check per kind of rule (the switch over kind of rules.cpp); a new kind without its check is
 * a type error.
 */
const RULE_CHECKS = Object.freeze({
  disjointRefs: checkDisjointRefs,
} satisfies { readonly [K in ParamRule['kind']]: RuleCheck });

/** The spec of a reference list param (not the single axis), undefined for any other key. */
function listSpecOf(schema: ParamSchema, key: string): RefParamSpec | undefined {
  if (!Object.hasOwn(schema, key)) return undefined;
  const spec: ParamSpec | undefined = schema[key];
  if (spec === undefined || !isRefParamSpec(spec) || spec.kind === 'axis') return undefined;
  return spec;
}

/** Whether the generic checks reported the params object or one of the params of the rule. */
function reported(issues: readonly ParamIssue[], rule: ParamRule): boolean {
  return issues.some(
    (issue) => issue.param === '' || issue.param === rule.param || issue.param === rule.other,
  );
}

function itemsOf(value: unknown): readonly unknown[] {
  // Array.isArray narrows to any[]; the items are unchecked data.
  return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
