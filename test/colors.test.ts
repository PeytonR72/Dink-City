import { describe, expect, it } from 'vitest';
import { CUSTOM_PARTS, loadColors, saveColors } from '../src/save/colors';
import type { KeyValueStore } from '../src/save/store';
import { DEFAULT_PLAYER_COLORS } from '../src/render/models';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe('Player colors', () => {
  it('are the model defaults the first time', () => {
    expect(loadColors(memoryStore())).toEqual(DEFAULT_PLAYER_COLORS);
  });

  it('customize shirt, shorts, paddle, skin and hair', () => {
    expect(CUSTOM_PARTS).toEqual(['shirt', 'shorts', 'paddle', 'skin', 'hair']);
  });

  it('come back as they were saved', () => {
    const store = memoryStore();
    saveColors(store, { ...DEFAULT_PLAYER_COLORS, shirt: '#2ec4b6', hair: '#f4d27a' });
    expect(loadColors(store)).toEqual({ ...DEFAULT_PLAYER_COLORS, shirt: '#2ec4b6', hair: '#f4d27a' });
  });

  it('only save the customizable parts', () => {
    const store = memoryStore();
    saveColors(store, { ...DEFAULT_PLAYER_COLORS, eye: '#ff0000', shirt: '#2ec4b6' });
    expect(loadColors(store)).toEqual({ ...DEFAULT_PLAYER_COLORS, shirt: '#2ec4b6' });
  });

  it('ignore anything that is not a hex color, or not a customizable part', () => {
    const raw = JSON.stringify({ shirt: 'red', shorts: '#12345', paddle: '#abcdef', eye: '#000000' });
    expect(loadColors(memoryStore({ 'dink.colors': raw }))).toEqual({ ...DEFAULT_PLAYER_COLORS, paddle: '#abcdef' });
    expect(loadColors(memoryStore({ 'dink.colors': 'nope' }))).toEqual(DEFAULT_PLAYER_COLORS);
    expect(loadColors(null)).toEqual(DEFAULT_PLAYER_COLORS);
  });
});
