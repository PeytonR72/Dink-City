// Saved data (settings, progress, colors) in localStorage. Storage can be missing, throw (private windows,
// blocked site data) or hold anything, so every read and write is wrapped and every value is validated.

/** The part of `Storage` we use, so tests can pass a plain object. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's localStorage, or null where even touching it throws. */
export function browserStore(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The parsed JSON under `key`, or undefined if there is none, it isn't JSON, or storage fails. */
export function readJson(store: KeyValueStore | null, key: string): unknown {
  try {
    const raw = store?.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/** Saves `value` as JSON; a failure just means it isn't saved. */
export function writeJson(store: KeyValueStore | null, key: string, value: unknown) {
  try {
    store?.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Could not save ${key}:`, e);
  }
}

/** `raw[field]` if it passes `valid`, otherwise `fallback`. */
export function field<T>(raw: unknown, name: string, valid: (v: unknown) => v is T, fallback: T): T {
  const v = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)[name] : undefined;
  return valid(v) ? v : fallback;
}
