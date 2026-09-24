// Settings from the menu, saved between visits. URL flags override them for playtesting.
import { DIFFICULTY } from '../bot/bot';
import { field, readJson, writeJson, type KeyValueStore } from './store';

export type DifficultyName = keyof typeof DIFFICULTY;

export interface Settings {
  rallyScoring: boolean;
  bestOf: 1 | 3;
  difficulty: DifficultyName;
  /** The Venue's sunset lighting instead of day. */
  sunset: boolean;
}

export const DEFAULT_SETTINGS: Settings = { rallyScoring: false, bestOf: 1, difficulty: 'medium', sunset: false };

const KEY = 'dink.settings';

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isBestOf = (v: unknown): v is 1 | 3 => v === 1 || v === 3;
export const isDifficulty = (v: unknown): v is DifficultyName => typeof v === 'string' && Object.hasOwn(DIFFICULTY, v);

export function loadSettings(store: KeyValueStore | null): Settings {
  const raw = readJson(store, KEY);
  const d = DEFAULT_SETTINGS;
  return {
    rallyScoring: field(raw, 'rallyScoring', isBoolean, d.rallyScoring),
    bestOf: field(raw, 'bestOf', isBestOf, d.bestOf),
    difficulty: field(raw, 'difficulty', isDifficulty, d.difficulty),
    sunset: field(raw, 'sunset', isBoolean, d.sunset),
  };
}

export function saveSettings(store: KeyValueStore | null, settings: Settings) {
  writeJson(store, KEY, settings);
}

/** Dev overrides: `?rally`, `?bo3`, `?bot=easy|medium|hard`, `?sunset`. */
export function withFlags(settings: Settings, params: URLSearchParams): Settings {
  const bot = params.get('bot');
  return {
    rallyScoring: settings.rallyScoring || params.has('rally'),
    bestOf: params.has('bo3') ? 3 : settings.bestOf,
    difficulty: isDifficulty(bot) ? bot : settings.difficulty,
    sunset: settings.sunset || params.has('sunset'),
  };
}
