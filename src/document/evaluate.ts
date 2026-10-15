import type { FeatureSchema, ParamIssue } from './schema';

// The one way from the raw params of a feature to the values that are computed with
// (M20, D4; "Parse, don't validate"). Without variables yet: the values pass through unchanged,
// but under their own type, so every reader that skips this function is a type error. Variables
// and expressions (Q003) change only the body of evaluateParams. The expression stays in the
// data of the feature; evaluated values are never stored.

// Exists only in types; at runtime an Evaluated<P> is the very object P.
declare const evaluatedBrand: unique symbol;

/** Params that went through evaluateParams: usable as P, but a plain P is not Evaluated<P>. */
export type Evaluated<P> = P & { readonly [evaluatedBrand]: true };

/** Values of variables by name (Q003); always NO_VARIABLES until variables exist. */
export type ParamVariables = ReadonlyMap<string, number>;

/** No variables. Frozen; the map itself is guarded by its ReadonlyMap type. */
export const NO_VARIABLES: ParamVariables = Object.freeze(new Map<string, number>());

/**
 * Evaluates the raw params of a feature (unknown: they come from the document unchecked) and
 * validates them with schema.validate. `params` is null exactly when `issues` is not empty.
 */
export function evaluateParams<P>(
  schema: FeatureSchema<P>,
  params: unknown,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- nothing to evaluate until Q003; the variables fix the signature
  variables: ParamVariables,
): { readonly params: Evaluated<P> | null; readonly issues: readonly ParamIssue[] } {
  const issues = schema.validate(params);
  if (issues.length > 0) return { params: null, issues };
  // The one place an Evaluated is minted: schema.validate accepted the params, so they are P.
  return { params: params as Evaluated<P>, issues };
}
