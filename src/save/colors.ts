// The local Player's colors from the locker, saved between visits. Only the customizable parts are saved; the
// rest (shoes, eyes, grip) always come from palette.json.
import { DEFAULT_PLAYER_COLORS, type PlayerColors } from '../render/models';
import { field, readJson, writeJson, type KeyValueStore } from './store';

export const CUSTOM_PARTS = ['shirt', 'shorts', 'paddle', 'skin', 'hair'] as const satisfies readonly (keyof PlayerColors)[];

const KEY = 'dink.colors';
const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

export function loadColors(store: KeyValueStore | null): PlayerColors {
  const raw = readJson(store, KEY);
  const colors = { ...DEFAULT_PLAYER_COLORS };
  for (const part of CUSTOM_PARTS) colors[part] = field(raw, part, isHex, colors[part]);
  return colors;
}

export function saveColors(store: KeyValueStore | null, colors: PlayerColors) {
  writeJson(store, KEY, Object.fromEntries(CUSTOM_PARTS.map((part) => [part, colors[part]])));
}
