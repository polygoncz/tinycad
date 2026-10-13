import type { OperationLoadError } from '../load-error';

// Small shape checks for validate of the built-in handlers (Q032). Only the shape of the
// payload, never its relation to the document (that is apply's job during replay).

/** Checks a value found at `path`; returns its problems, empty when fine. */
type Check = (value: unknown, path: string) => readonly OperationLoadError[];
type Shape = Readonly<Record<string, Check>>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const check =
  (test: (value: unknown) => boolean, message: string): Check =>
  (value, path) =>
    test(value) ? [] : [{ path, message }];

export const nonEmptyString = check(
  (v) => typeof v === 'string' && v !== '',
  'Must be a non-empty string',
);
export const string = check((v) => typeof v === 'string', 'Must be a string');
export const boolean = check((v) => typeof v === 'boolean', 'Must be a boolean');
export const plainObject = check(isRecord, 'Must be an object');
export const wholeNumber = (min: number): Check =>
  check(
    (v) => typeof v === 'number' && Number.isInteger(v) && v >= min,
    `Must be a whole number >= ${String(min)}`,
  );

/** An object whose listed fields pass their checks; other fields are ignored. */
export const object =
  (shape: Shape): Check =>
  (value, path) =>
    isRecord(value)
      ? Object.entries(shape).flatMap(([key, field]) =>
          field(value[key], path === '' ? key : `${path}.${key}`),
        )
      : [{ path, message: 'Must be an object' }];

/** validate of a handler: the operation's payload fields, paths relative to the operation. */
export const validateShape =
  (shape: Shape) =>
  (raw: Readonly<Record<string, unknown>>): readonly OperationLoadError[] =>
    object(shape)(raw, '');
