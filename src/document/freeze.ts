/**
 * Freezes a plain-data value recursively and returns it. Always on, not only in dev (Q027).
 * No shortcut at already frozen objects: a shallowly frozen object from outside could
 * still hide mutable data. Use it for data entering the document; mutators freeze only
 * the new array and studio, whose elements are already deeply frozen.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
