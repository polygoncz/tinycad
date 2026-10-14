// File names of downloads (spec 11, "Export a historie"): the document name made safe for the
// file systems of Windows, macOS and Linux. Internal to app.

/** At most this many characters; the extension comes on top. */
const MAX_LENGTH = 100;

const FALLBACK = 'tinycad';

// Forbidden on Windows, plus every control character (C0 and DEL).
// eslint-disable-next-line no-control-regex -- control characters are exactly what is matched
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/** Spaces and dots at either end (Windows drops trailing ones, a leading dot hides the file). */
const EDGES = /^[\s.]+|[\s.]+$/g;

/**
 * `\ / : * ? " < > |` and control characters → `_`, spaces and dots trimmed at both ends, at
 * most 100 characters; an empty result is 'tinycad'.
 */
export function safeFileName(name: string): string {
  const cut = name.replace(UNSAFE, '_').replace(EDGES, '').slice(0, MAX_LENGTH);
  // The cut may leave a space or a dot at the end again.
  const trimmed = cut.replace(EDGES, '');
  return trimmed === '' ? FALLBACK : trimmed;
}
