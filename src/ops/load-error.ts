// Kept apart from upcast.ts so that op-handler.ts (validate) can use it without a cycle.

/** A problem in data from outside (stored log), with a path relative to the checked value. */
export interface OperationLoadError {
  readonly path: string;
  readonly message: string;
}
