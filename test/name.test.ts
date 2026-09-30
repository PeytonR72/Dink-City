import { describe, expect, it } from 'vitest';
import { guestName, loadName, saveName } from '../src/save/name';
import type { KeyValueStore } from '../src/save/store';
import { validateDisplayName } from '../src/net';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

const throwing: KeyValueStore = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
};

describe('The Display name', () => {
  it('is not there the first time', () => {
    expect(loadName(memoryStore())).toBeNull();
    expect(loadName(null)).toBeNull();
  });

  it('comes back as it was saved, under dink.name', () => {
    const store = memoryStore();
    saveName(store, 'Ana');
    expect(Object.keys(store.data)).toEqual(['dink.name']);
    expect(loadName(store)).toBe('Ana');
  });

  it('comes back normalized', () => {
    expect(loadName(memoryStore({ 'dink.name': JSON.stringify('  Ana   Bea ') }))).toBe('Ana Bea');
  });

  it('is dropped when it no longer passes the check, or is not a string', () => {
    expect(loadName(memoryStore({ 'dink.name': JSON.stringify('<script>') }))).toBeNull();
    expect(loadName(memoryStore({ 'dink.name': JSON.stringify('x'.repeat(17)) }))).toBeNull();
    expect(loadName(memoryStore({ 'dink.name': '42' }))).toBeNull();
    expect(loadName(memoryStore({ 'dink.name': '{not json' }))).toBeNull();
  });

  it('survives storage that throws', () => {
    expect(loadName(throwing)).toBeNull();
    expect(() => saveName(throwing, 'Ana')).not.toThrow();
  });
});

describe('A guest name', () => {
  it('is "Guest" and four digits', () => {
    expect(guestName(() => 0)).toBe('Guest 1000');
    expect(guestName(() => 0.4821)).toBe('Guest 5338');
    expect(guestName(() => 0.99999)).toBe('Guest 9999');
  });

  it('is a valid Display name', () => {
    for (const r of [0, 0.5, 0.99999]) expect(validateDisplayName(guestName(() => r)).ok).toBe(true);
  });
});
