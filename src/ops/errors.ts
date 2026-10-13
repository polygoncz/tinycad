// Deliberate copy of the internal src/core/collect-errors.ts (core does not export it).
// The rule must stay the same in both places: one error as it is, several as AggregateError.
/** Throws one collected error as it is, several as AggregateError; none = no-op. */
export function throwCollected(errors: readonly unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}
