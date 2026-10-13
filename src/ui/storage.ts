// Remembered UI choices (language, theme) live in localStorage. The interface is the part of
// Web Storage ui uses, so tests can pass a Map-backed fake.

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage, or null where touching it throws (blocked storage, private mode). */
export function browserStorage(): KeyValueStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
