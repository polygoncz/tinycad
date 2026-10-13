// Internal helper shared by Emitter and DisposableStore: a failing callback must
// not stop the others, but the failure must not be swallowed either. core has no
// console (ADR 0009, Q022), so errors are rethrown once every callback has run.
export function throwCollected(errors: readonly unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}
