// Which Venue Bots have been beaten, and at which Difficulties. Venues unlock in order: beating a Venue's Bot at
// any Difficulty opens the next one.
import { DIFFICULTY } from '../bot/bot';
import { VENUE_IDS, type VenueId } from '../venue/venues';
import { isDifficulty, type DifficultyName } from './settings';
import { readJson, writeJson, type KeyValueStore } from './store';

/** The Difficulties each Venue's Bot has been beaten at (one star each). */
export type Progress = Record<VenueId, DifficultyName[]>;

const KEY = 'dink.progress';
const ORDER = Object.keys(DIFFICULTY) as DifficultyName[];

export function loadProgress(store: KeyValueStore | null): Progress {
  const raw = readJson(store, KEY) as Record<string, unknown> | undefined;
  const beaten = (id: VenueId) => {
    const v = raw && typeof raw === 'object' ? raw[id] : undefined;
    return Array.isArray(v) ? sorted(v.filter(isDifficulty)) : [];
  };
  return { park: beaten('park'), rooftop: beaten('rooftop'), beach: beaten('beach') };
}

export function saveProgress(store: KeyValueStore | null, progress: Progress) {
  writeJson(store, KEY, progress);
}

/** The first Venue is always open; each later one once every Venue before it has been beaten. */
export function isUnlocked(progress: Progress, id: VenueId): boolean {
  const index = VENUE_IDS.indexOf(id);
  return VENUE_IDS.slice(0, index).every((before) => progress[before].length > 0);
}

export function recordWin(progress: Progress, id: VenueId, difficulty: DifficultyName): Progress {
  return { ...progress, [id]: sorted([...progress[id], difficulty]) };
}

function sorted(ds: DifficultyName[]): DifficultyName[] {
  return [...new Set(ds)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
}
