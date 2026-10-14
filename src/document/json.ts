// Plain JSON (spec 03): the one check for reading (fromData) and writing (op validate, M19.1),
// so that a write never accepts what a read refuses.

/**
 * A plain JSON value: null, a string, a boolean, a finite number, an array of JSON values
 * without holes or a plain JSON object. IndexedDB stores structured clones, so Map, Date, class
 * instances, undefined or NaN could otherwise slip into the document and break the JSON round
 * trip. Linear in the size of the value and without allocations: it runs on every drag step of
 * a sketch.
 */
export function isJsonValue(v: unknown): boolean {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) {
    const items: readonly unknown[] = v;
    // An index loop, not every(): every() skips holes, which JSON writes as null.
    for (let i = 0; i < items.length; i++) if (!isJsonValue(items[i])) return false;
    return true;
  }
  return isJsonObject(v);
}

/** An object with the prototype Object.prototype or null whose values are all plain JSON. */
export function isJsonObject(v: unknown): v is Record<string, unknown> {
  if (!isRecord(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return false;
  for (const key in v) {
    // for…in also walks inherited enumerable keys; only own ones are data.
    if (Object.hasOwn(v, key) && !isJsonValue(v[key])) return false;
  }
  return true;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
