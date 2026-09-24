import { describe, expect, it } from 'vitest';
import { isUnlocked, loadProgress, recordWin, saveProgress } from '../src/save/progress';
import type { KeyValueStore } from '../src/save/store';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe('Venue progress', () => {
  it('starts with only the Park open and nothing beaten', () => {
    const p = loadProgress(memoryStore());
    expect(isUnlocked(p, 'park')).toBe(true);
    expect(isUnlocked(p, 'rooftop')).toBe(false);
    expect(isUnlocked(p, 'beach')).toBe(false);
    expect(p).toEqual({ park: [], rooftop: [], beach: [] });
  });

  it('opens the next Venue when its Bot is beaten, at any Difficulty', () => {
    const p = recordWin(loadProgress(memoryStore()), 'park', 'easy');
    expect(isUnlocked(p, 'rooftop')).toBe(true);
    expect(isUnlocked(p, 'beach')).toBe(false);
  });

  it('opens Venues in order only', () => {
    // A win somewhere locked (only possible by hand-editing storage) opens nothing past the gap.
    const p = recordWin(loadProgress(memoryStore()), 'rooftop', 'hard');
    expect(isUnlocked(p, 'rooftop')).toBe(false);
    expect(isUnlocked(p, 'beach')).toBe(false);
  });

  it('keeps a star per Difficulty beaten, once each', () => {
    let p = loadProgress(memoryStore());
    for (const d of ['medium', 'easy', 'medium'] as const) p = recordWin(p, 'park', d);
    expect(p.park).toEqual(['easy', 'medium']);
  });

  it('is saved and loaded', () => {
    const store = memoryStore();
    saveProgress(store, recordWin(loadProgress(store), 'park', 'hard'));
    expect(loadProgress(store).park).toEqual(['hard']);
    expect(isUnlocked(loadProgress(store), 'rooftop')).toBe(true);
  });

  it('survives broken or throwing storage', () => {
    const empty = { park: [], rooftop: [], beach: [] };
    expect(loadProgress(memoryStore({ 'dink.progress': '[1,2' }))).toEqual(empty);
    expect(loadProgress(memoryStore({ 'dink.progress': '{"park":["easy","legend",3],"beach":"hard"}' }))).toEqual({ ...empty, park: ['easy'] });
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadProgress(throwing)).toEqual(empty);
    expect(() => saveProgress(throwing, empty)).not.toThrow();
  });
});
