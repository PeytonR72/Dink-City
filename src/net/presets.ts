// The Host picks one Preset when creating a Court; it's fixed from then on.
import type { ContactMode, MatchConfig } from '../sim';

/** A Preset's name in the menu and its Match rules. */
export interface Preset {
  label: string;
  config: MatchConfig;
}

/** Quick (Rally scoring), Standard (Side-out) and Long (best of 3, Side-out); every Game to 11, win by 2. */
export const PRESETS = {
  quick: { label: 'Quick', config: { pointsToWin: 11, winBy: 2, rallyScoring: true, bestOf: 1 } },
  standard: { label: 'Standard', config: { pointsToWin: 11, winBy: 2, rallyScoring: false, bestOf: 1 } },
  long: { label: 'Long', config: { pointsToWin: 11, winBy: 2, rallyScoring: false, bestOf: 3 } },
} as const satisfies Record<string, Preset>;

export type PresetId = keyof typeof PRESETS;

/** Standard, the offline default rules. */
export const DEFAULT_PRESET: PresetId = 'standard';

/** Online, each Player's own client calls their hits (Reported Contact, ADR-0004), for the whole Match. */
const ONLINE_CONTACT: readonly [ContactMode, ContactMode] = ['reported', 'reported'];

/** The rules an online Match on this Preset runs: the Preset's, with Reported Contact for both Sides. */
export function onlineConfig(id: PresetId): MatchConfig {
  return { ...PRESETS[id].config, contactMode: [...ONLINE_CONTACT] };
}

/** Guards a Preset id from the wire. */
export function isPresetId(v: unknown): v is PresetId {
  return typeof v === 'string' && Object.hasOwn(PRESETS, v);
}
