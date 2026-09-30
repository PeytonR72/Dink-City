// The Host picks one Preset when creating a Court; it's fixed from then on.
import type { MatchConfig } from '../sim';

export interface Preset {
  label: string;
  config: MatchConfig;
}

export const PRESETS = {
  quick: { label: 'Quick', config: { pointsToWin: 11, winBy: 2, rallyScoring: true, bestOf: 1 } },
  standard: { label: 'Standard', config: { pointsToWin: 11, winBy: 2, rallyScoring: false, bestOf: 1 } },
  long: { label: 'Long', config: { pointsToWin: 11, winBy: 2, rallyScoring: false, bestOf: 3 } },
} as const satisfies Record<string, Preset>;

export type PresetId = keyof typeof PRESETS;

export const DEFAULT_PRESET: PresetId = 'standard';

export function isPresetId(v: unknown): v is PresetId {
  return typeof v === 'string' && Object.hasOwn(PRESETS, v);
}
