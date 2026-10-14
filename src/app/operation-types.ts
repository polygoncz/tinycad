// The types of the built-in operations (spec 11, M15): the dispatcher writes the type as the
// label of a log entry without one, so ui translates it in the history panel. ui may not import
// ops, so app hands the list over; it follows OP_VERSION, so a new operation needs no copy.

import { OP_VERSION } from '@/ops';

/** Every key of OP_VERSION, 'batch' included. */
export const BUILT_IN_OPERATION_TYPES: readonly string[] = Object.freeze(Object.keys(OP_VERSION));
