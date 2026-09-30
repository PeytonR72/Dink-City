// The Display name for online play, saved between visits. The Court checks it again; a saved name that no longer
// passes the check is dropped.
import { validateDisplayName } from '../net';
import { readJson, writeJson, type KeyValueStore } from './store';

const KEY = 'dink.name';

/** The saved Display name, normalized, or null if none is saved or it isn't valid. */
export function loadName(store: KeyValueStore | null): string | null {
  const result = validateDisplayName(readJson(store, KEY));
  return result.ok ? result.name : null;
}

export function saveName(store: KeyValueStore | null, name: string) {
  writeJson(store, KEY, name);
}

/** A suggestion for a first-time Player, like "Guest 4821". `random` is in [0, 1). */
export function guestName(random: () => number = Math.random): string {
  return `Guest ${1000 + Math.floor(random() * 9000)}`;
}
