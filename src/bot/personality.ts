// The Venue Bots' Personalities (CONTEXT.md): shot weights plus a small, fitting Difficulty tweak.
// Tuned with Bot-vs-Bot stats (test/personality.test.ts). Rallies won against a neutral medium Bot, over five
// Games (2026-09-24): Dinker 57%, Lobber 46%, Banger 43% (a neutral Bot: 49%).
import type { Personality } from './bot';

export const PERSONALITY = {
  /** Patient at the Kitchen line and careful with it, but aims closer to the middle: the first Venue's Bot. */
  dinker: { weights: { soft: 2.5, drive: 0.6, lob: 0.5 }, adjust: { kitchenDiscipline: 0.03, aimWidth: -0.2 } },
  /** Hits hard and wide, and misses more for it. */
  banger: { weights: { soft: 0.45, drive: 2.5, lob: 0.5 }, adjust: { aimWidth: 0.1, unforcedError: 0.03 } },
  /** Throws the ball up over a player at the net, and mixes it up more. */
  lobber: { weights: { soft: 0.9, drive: 0.7, lob: 4 }, adjust: { shotChoiceAccuracy: -0.1 } },
} satisfies Record<string, Personality>;

export type PersonalityName = keyof typeof PERSONALITY;
