import { validateAgainstSchema } from '@/document';
import type { BodyRef, FeatureSchema, ParamIssue, ParamSchema, ParamSpec } from '@/document';

// The data half of the boolean feature (ADR 0004): params, defaults and validation.

export interface BooleanParams {
  /** union merges the tools into the first target; subtract and intersect use all targets. */
  readonly op: 'union' | 'subtract' | 'intersect';
  /** The first target gives the result its identity (spec 07, Builder featury). */
  readonly targets: readonly BodyRef[];
  readonly tools: readonly BodyRef[];
  /** Keep the tool bodies instead of consuming them. */
  readonly keepTools: boolean;
}

// Frozen deeply – the schema object, every ParamSpec and the enum options: the schema is shared
// by the registry, the UI form and the validation, so nobody may change it in place.
// Labels are translation keys (ADR 0014), the texts are in messages.ts. Two lists for every
// operation (R9): one schema without conditional params, one identity rule for all three.
const params: ParamSchema = Object.freeze<ParamSchema>({
  op: Object.freeze<ParamSpec>({
    kind: 'enum',
    label: 'boolean.op',
    default: 'union',
    options: Object.freeze([
      Object.freeze({ value: 'union', label: 'boolean.op.union' }),
      Object.freeze({ value: 'subtract', label: 'boolean.op.subtract' }),
      Object.freeze({ value: 'intersect', label: 'boolean.op.intersect' }),
    ]),
  }),
  targets: Object.freeze<ParamSpec>({ kind: 'bodies', label: 'boolean.targets', min: 1 }),
  tools: Object.freeze<ParamSpec>({ kind: 'bodies', label: 'boolean.tools', min: 1 }),
  keepTools: Object.freeze<ParamSpec>({
    kind: 'boolean',
    label: 'boolean.keepTools',
    default: false,
  }),
});

export const booleanSchema: FeatureSchema<BooleanParams> = Object.freeze<
  FeatureSchema<BooleanParams>
>({
  type: 'boolean',
  version: 1,
  label: 'boolean.label',
  icon: 'layers-union',
  params,
  defaults(): BooleanParams {
    return { op: 'union', targets: [], tools: [], keepTools: false };
  },
  validate(raw: unknown): readonly ParamIssue[] {
    const issues = validateAgainstSchema(params, raw);
    const sameBody = sameBodyIssue(raw, issues);
    return sameBody === undefined ? issues : [...issues, sameBody];
  },
});

/**
 * The own rule of the boolean (R12): a body that is a target and a tool. Checked only when both
 * lists passed the generic checks; reports the first such tool by its index in tools, like
 * param.duplicateRef reports the first duplicate.
 */
function sameBodyIssue(raw: unknown, issues: readonly ParamIssue[]): ParamIssue | undefined {
  if (issues.some((i) => i.param === '' || i.param === 'targets' || i.param === 'tools')) {
    return undefined;
  }
  // validateAgainstSchema reported nothing at the object, targets and tools: both are BodyRef[].
  const { targets, tools } = raw as Pick<BooleanParams, 'targets' | 'tools'>;
  const targetIds = new Set(targets.map((r) => r.body));
  const index = tools.findIndex((r) => targetIds.has(r.body));
  return index === -1 ? undefined : { param: 'tools', code: 'boolean.sameBody', params: { index } };
}
