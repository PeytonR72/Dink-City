import { describe, expect, it } from 'vitest';
import { DIFFICULTY, createBot, type Difficulty } from '../src/bot/bot';
import { observe } from '../src/bot/observe';
import { createInitialState, step, type Intent, type SimEvent, type SimState } from '../src/sim';
import { simTuning as t } from '../src/tuning';

const MAX_TICKS = 60 * 60 * 20;

/** A seeded Bot-vs-Bot Game, recording every Tick's Intents. */
function botGame(seed: number, difficulty: Difficulty = DIFFICULTY.medium) {
  const bots = [createBot(0, seed + 1, difficulty, t), createBot(1, seed + 2, difficulty, t)] as const;
  const start = createInitialState(seed);
  let s: SimState = start;
  const intents: [Intent, Intent][] = [];
  const events: SimEvent[] = [];
  while (s.phase !== 'over' && s.tick < MAX_TICKS) {
    const pair: [Intent, Intent] = [bots[0].think(observe(s, 0)), bots[1].think(observe(s, 1))];
    intents.push(pair);
    s = step(s, pair, t);
    events.push(...s.events);
  }
  return { start, end: s, intents, events };
}

const game = botGame(2026);
const GOLDEN = { points: [17, 15], tick: 62963 };
const deads = game.events.filter((e) => e.kind === 'dead');

describe('Bot-vs-Bot Game', () => {
  it('plays a full Game to completion', () => {
    expect(game.end.phase).toBe('over');
    const [a, b] = game.end.match.points;
    expect(Math.max(a, b)).toBeGreaterThanOrEqual(11);
    expect(Math.abs(a - b)).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic: the same seeds give the same Intents', () => {
    expect(JSON.stringify(botGame(2026).intents)).toBe(JSON.stringify(game.intents));
  });

  it('matches the recorded golden result', () => {
    // Update deliberately when Sim, Bot or Tuning changes are meant to change play.
    expect({ points: game.end.match.points, tick: game.end.tick }).toEqual(GOLDEN);
  });

  it('replays exactly from its recorded Intents (golden)', () => {
    let s = game.start;
    for (const pair of game.intents) s = step(s, pair, t);
    expect(JSON.stringify(s)).toBe(JSON.stringify(game.end));
  });

  it('actually rallies', () => {
    const hits = game.events.filter((e) => e.kind === 'hit').length;
    expect(hits / deads.length).toBeGreaterThan(4);
  });

  it('with full discipline, never commits a Kitchen or Two-bounce Fault', () => {
    const strict = botGame(7, { ...DIFFICULTY.medium, kitchenDiscipline: 1 });
    const faults = strict.events.filter((e) => e.kind === 'dead' && (e.reason === 'kitchen' || e.reason === 'two-bounce'));
    expect(faults).toEqual([]);
  });
});
