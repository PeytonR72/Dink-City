import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTY, createBot, type Difficulty } from '../src/bot/bot';
import { observe } from '../src/bot/observe';
import { createInitialState, step, type Intent, type SimEvent, type SimState } from '../src/sim';
import { simTuning as t } from '../src/tuning';

const MAX_TICKS = 60 * 60 * 30;
// Each Bot-vs-Bot Game takes a few seconds.
vi.setConfig({ testTimeout: 60_000 });

/** A seeded Bot-vs-Bot Game, recording every Tick's Intents. */
function botGame(seed: number, difficulty: Difficulty = DIFFICULTY.medium, opponent: Difficulty = difficulty) {
  const bots = [createBot(0, seed + 1, difficulty, t), createBot(1, seed + 2, opponent, t)] as const;
  const start = createInitialState(seed);
  let s: SimState = start;
  const intents: [Intent, Intent][] = [];
  /** The Intents pressing a shot button during a Rally (not a Serve). */
  const rallyShots: Intent[] = [];
  const events: SimEvent[] = [];
  while (s.phase !== 'over' && s.tick < MAX_TICKS) {
    const pair: [Intent, Intent] = [bots[0].think(observe(s, 0)), bots[1].think(observe(s, 1))];
    intents.push(pair);
    if (s.phase === 'rally') rallyShots.push(...pair.filter((i) => i.shot));
    s = step(s, pair, t);
    events.push(...s.events);
  }
  return { start, end: s, intents, rallyShots, events };
}

/** Rally hits (not Serves). */
function hits(events: SimEvent[]) {
  return events.flatMap((e) => (e.kind === 'hit' && e.variant !== 'serve' ? [e] : []));
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const handicaps = new Map<string, ReturnType<typeof measureHandicap>>();

/**
 * A medium Bot with one handicap changed (the others off), against a plain medium Bot: its mean Shot quality
 * and factors, and the share of its shots that went out or into the net. Two Games pooled, since one Game's
 * averages are noisy.
 */
function handicapped(change: Partial<Difficulty>) {
  const key = JSON.stringify(change);
  if (!handicaps.has(key)) handicaps.set(key, measureHandicap(change));
  return handicaps.get(key)!;
}

function measureHandicap(change: Partial<Difficulty>) {
  const events = [6, 7].flatMap(
    (seed) => botGame(seed, { ...DIFFICULTY.medium, lateCommit: 0, offCenter: 0, unforcedError: 0, ...change }, DIFFICULTY.medium).events,
  );
  const mine = hits(events).filter((h) => h.side === 0);
  const errors = events.filter((e) => e.kind === 'dead' && e.loser === 0 && (e.reason === 'out' || e.reason === 'net'));
  return {
    quality: mean(mine.map((h) => h.quality)),
    timing: mean(mine.map((h) => h.factors.timing)),
    set: mean(mine.map((h) => h.factors.set)),
    errorRate: errors.length / mine.length,
  };
}

/**
 * Bot-vs-Bot Games, watching every ball a Bot lets go: how often its sideways movement changes direction while
 * it leaves the ball, and how many of those balls landed in. Also its moves while the ball is dead.
 */
function leaves(seeds: number[], difficulty: Difficulty) {
  let count = 0;
  let flips = 0;
  let landedIn = 0;
  const deadMoves: number[] = [];
  for (const seed of seeds) {
    const bots = [createBot(0, seed + 1, difficulty, t), createBot(1, seed + 2, difficulty, t)];
    let s: SimState = createInitialState(seed);
    const watch = [0, 1].map(() => ({ on: false, sign: 0 }));
    while (s.phase !== 'over' && s.tick < MAX_TICKS) {
      const pair = [bots[0].think(observe(s, 0)), bots[1].think(observe(s, 1))] as [Intent, Intent];
      for (const i of [0, 1] as const) {
        const w = watch[i];
        if (s.phase === 'dead') deadMoves.push(Math.hypot(pair[i].move.x, pair[i].move.y));
        if (s.phase !== 'rally') continue;
        if (bots[i].plan.leave && !w.on) {
          count++;
          Object.assign(w, { on: true, sign: 0 });
        }
        if (!w.on || Math.abs(pair[i].move.x) < 0.02) continue;
        const sign = Math.sign(pair[i].move.x);
        if (w.sign !== 0 && sign !== w.sign) flips++;
        w.sign = sign;
      }
      s = step(s, pair, t);
      for (const e of s.events) {
        // Committed before it read the ball as out, the Bot still swings; that ball wasn't left after all.
        if (e.kind === 'hit') watch[e.side].on = false;
        if (e.kind !== 'dead') continue;
        for (const i of [0, 1] as const) {
          if (watch[i].on && e.loser === i && e.reason === 'double-bounce') landedIn++;
          watch[i].on = false;
        }
      }
    }
  }
  return { count, flips, landedIn, deadMoves };
}

const game = botGame(2026);
const GOLDEN = { points: [11, 6], tick: 30485 };
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

describe('Letting a ball go', () => {
  // Seed 6 used to leave a ball that landed in; seed 2 leaves plenty.
  const left = leaves([2, 6], DIFFICULTY.medium);

  it('happens: Bots do leave balls going out', () => {
    expect(left.count).toBeGreaterThan(5);
  });

  it('settles calmly into position, without twitching sideways', () => {
    expect(left.flips).toBe(0);
  });

  it("doesn't give up on a ball that lands in", () => {
    expect(left.landedIn).toBe(0);
  });

  it('walks, rather than freezing mid-stride, while the ball is dead', () => {
    expect(Math.max(...left.deadMoves)).toBeLessThanOrEqual(0.4);
    expect(left.deadMoves.filter((m) => m > 0).length).toBeGreaterThan(0);
  });
});

describe('Difficulty', () => {
  it('moves no faster than its move speed, a fraction of the human top speed', () => {
    const { moveSpeed } = DIFFICULTY.medium;
    expect(moveSpeed).toBeLessThan(1);
    const fastest = game.intents.flat().reduce((m, i) => Math.max(m, Math.hypot(i.move.x, i.move.y)), 0);
    expect(fastest).toBeLessThanOrEqual(moveSpeed + 1e-9);
  });

  it('a medium Bot rarely paints the lines', () => {
    const shots = game.rallyShots;
    const nearLine = shots.filter((i) => Math.abs(i.aim.x) > 0.8).length;
    expect(shots.length).toBeGreaterThan(100);
    expect(nearLine / shots.length).toBeLessThan(0.1);
  });

  it('a Bot that always commits late hits rushed shots', () => {
    const early = handicapped({});
    const late = handicapped({ lateCommit: 1 });
    expect(late.timing).toBeLessThan(early.timing - 0.15);
  });

  it('a Bot that sets up off-center meets the ball away from the sweet spot, and hits weaker shots', () => {
    // The contact assist fixes most of the footwork, as it does for humans, so `set` drops only a little;
    // the last-moment Commit does the rest.
    const centered = handicapped({});
    const off = handicapped({ offCenter: 1 });
    expect(off.set).toBeLessThan(centered.set - 0.03);
    expect(off.quality).toBeLessThan(centered.quality - 0.15);
  });

  it('a Bot that makes unforced errors hits more of its shots out or into the net', () => {
    const clean = handicapped({});
    const errorProne = handicapped({ unforcedError: 1 });
    // The Sim forgives a lot (contact assist, in-court aim clamp), so most Unforced errors are weak balls
    // rather than outright misses.
    expect(errorProne.errorRate).toBeGreaterThan(clean.errorRate * 2);
  });
});
