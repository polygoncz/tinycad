import { isBodyColor, isJsonObject, ORIGIN, parseBodyId } from '@/document';
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
/**
 * A new feature id: the owner part of artifact ids, so it must not contain '/', and 'origin' is
 * the reserved owner of the origin geometry (spec 03, M12).
 */
export const featureIdText = check(
  (v) => typeof v === 'string' && v !== '' && !v.includes('/') && v !== ORIGIN,
  "Must be a non-empty string without '/', other than 'origin'",
);
/** A body id '<owner>/body[:<n>]', the shape bodyId mints (spec 03). */
export const bodyIdText = check(
  (v) => parseBodyId(v) !== undefined,
  "Must be a body id '<feature>/body' or '<feature>/body:<n>'",
);
/** A body color '#rrggbb' in lower case or null for the default (M15); no canonicalization. */
export const bodyColorOrNull = check(
  (v) => v === null || isBodyColor(v),
  "Must be null or a color '#rrggbb' in lower case",
);
export const string = check((v) => typeof v === 'string', 'Must be a string');
export const boolean = check((v) => typeof v === 'boolean', 'Must be a boolean');
/**
 * Feature params: a plain JSON object as fromData demands (spec 03), so neither a stored log
 * nor a live write can carry NaN, undefined or a Date that the document could not load back.
 */
export const jsonObject = check(isJsonObject, 'Must be a plain JSON object');
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
