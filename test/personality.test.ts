import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTY, NEUTRAL, createBot, type Personality } from '../src/bot/bot';
import { observe } from '../src/bot/observe';
import { PERSONALITY } from '../src/bot/personality';
import { createInitialState, step, type ShotType, type SimEvent, type SimState } from '../src/sim';
import { simTuning as t } from '../src/tuning';

vi.setConfig({ testTimeout: 60_000 });

/** A seeded Game of a hard Bot with `personality` (Side 0) against a neutral hard Bot. */
function game(personality: Personality, seed = 11) {
  const bots = [createBot(0, seed + 1, DIFFICULTY.hard, t, personality), createBot(1, seed + 2, DIFFICULTY.hard, t)] as const;
  let s: SimState = createInitialState(seed);
  const events: SimEvent[] = [];
  while (s.phase !== 'over' && s.tick < 60 * 60 * 30) {
    s = step(s, [bots[0].think(observe(s, 0)), bots[1].think(observe(s, 1))], t);
    events.push(...s.events);
  }
  return { events, end: s };
}

/** The share of Side 0's Rally hits (not Serves) of each Shot type. */
function mix(events: SimEvent[]): Record<ShotType, number> {
  const hits = events.flatMap((e) => (e.kind === 'hit' && e.side === 0 && e.variant !== 'serve' ? [e.type] : []));
  const share = (type: ShotType) => hits.filter((h) => h === type).length / hits.length;
  return { soft: share('soft'), drive: share('drive'), lob: share('lob') };
}

const neutral = mix(game(NEUTRAL).events);

describe('Personalities', () => {
  it('the Dinker plays more Soft shots than a neutral Bot', () => {
    expect(mix(game(PERSONALITY.dinker).events).soft).toBeGreaterThan(neutral.soft + 0.1);
  });

  it('the Banger plays more Drives than a neutral Bot', () => {
    expect(mix(game(PERSONALITY.banger).events).drive).toBeGreaterThan(neutral.drive + 0.1);
  });

  it('the Lobber lobs several times as often as a neutral Bot', () => {
    const lobs = mix(game(PERSONALITY.lobber).events).lob;
    expect(lobs).toBeGreaterThan(0.1);
    expect(lobs).toBeGreaterThan(neutral.lob * 3);
  });

  it('each still wins some points against a neutral Bot of the same Difficulty', () => {
    for (const p of Object.values(PERSONALITY)) {
      const { end } = game(p);
      expect(end.phase).toBe('over');
      expect(end.match.points[0]).toBeGreaterThanOrEqual(3);
    }
  });
});
