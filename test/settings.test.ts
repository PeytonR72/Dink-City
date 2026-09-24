import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, withFlags } from '../src/save/settings';
import type { KeyValueStore } from '../src/save/store';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const throwing: KeyValueStore = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
};

describe('Settings', () => {
  it('are the defaults the first time', () => {
    expect(loadSettings(memoryStore())).toEqual({ rallyScoring: false, bestOf: 1, difficulty: 'medium', sunset: false });
  });

  it('come back as they were saved', () => {
    const store = memoryStore();
    saveSettings(store, { rallyScoring: true, bestOf: 3, difficulty: 'hard', sunset: true });
    expect(loadSettings(store)).toEqual({ rallyScoring: true, bestOf: 3, difficulty: 'hard', sunset: true });
  });

  it('fall back to the defaults when storage throws', () => {
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(throwing, DEFAULT_SETTINGS)).not.toThrow();
  });

  it('fall back to the defaults when there is no storage at all', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('ignore garbage, keeping any field that is still valid', () => {
    expect(loadSettings(memoryStore({ 'dink.settings': '{not json' }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memoryStore({ 'dink.settings': '{"bestOf":3,"difficulty":"impossible","rallyScoring":"yes"}' }))).toEqual({
      ...DEFAULT_SETTINGS,
      bestOf: 3,
    });
  });

  it('are overridden by URL flags, for playtesting', () => {
    const saved = { ...DEFAULT_SETTINGS, difficulty: 'hard' as const };
    expect(withFlags(saved, new URLSearchParams('?rally&bo3&bot=easy&sunset'))).toEqual({
      rallyScoring: true,
      bestOf: 3,
      difficulty: 'easy',
      sunset: true,
    });
    expect(withFlags(saved, new URLSearchParams(''))).toEqual(saved);
    expect(withFlags(saved, new URLSearchParams('?bot=nonsense')).difficulty).toBe('hard');
  });
});
