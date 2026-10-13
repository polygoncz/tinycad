import type { Registry } from '@/core';
import type { DocumentReader, DocumentWriter } from '@/document';
import type { Operation } from './operation';

// Kept apart from handler.ts so that the built-in handlers can import the interface
// without a cycle (handler.ts imports the handlers to pre-fill the registry).

export interface OpHandler<O extends Operation = Operation> {
  readonly type: string;
  readonly version: number;
  /** Computes the inverse from the CURRENT state – called BEFORE apply. Must not mutate. */
  invert(doc: DocumentReader, op: O): Operation;
  /** Applies the change. Must be deterministic: no Date.now, Math.random, new ids. */
  apply(doc: DocumentWriter, op: O): void;
  /** Optional: merges two consecutive operations (e.g. two setParams of one feature). */
  merge?(prev: O, next: O): O | null;
  /** Converts an older version of the operation to the current one when loading a log. */
  upcast?(fromVersion: number, raw: unknown): O;
}

export type OpHandlerRegistry = Registry<OpHandler>;
