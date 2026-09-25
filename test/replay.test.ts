import { describe, expect, it } from 'vitest';
import { DIFFICULTY, createBot } from '../src/bot/bot';
import { observe } from '../src/bot/observe';
import { createReplay, type RecordedRally } from '../src/replay/replay';
import { TICK, createInitialState, step, type Intent, type SimEvent, type SimState } from '../src/sim';
import { simTuning as t } from '../src/tuning';

/** Bot-vs-Bot Rallies from a seeded Match, recorded the way main.ts records them, up to each Rally's end. */
function recordRally(seed: number, minTicks = 0): { rally: RecordedRally; dead: SimState } {
  const bots = [createBot(0, seed + 1, DIFFICULTY.medium, t), createBot(1, seed + 2, DIFFICULTY.medium, t)] as const;
  let s = createInitialState(seed);
  let rally: { start: SimState; intents: [Intent, Intent][] } = { start: s, intents: [] };
  for (;;) {
    const intents: [Intent, Intent] = [bots[0].think(observe(s, 0)), bots[1].think(observe(s, 1))];
    const prev = s;
    s = step(s, intents, t);
    if (s.phase === 'serve' && prev.phase !== 'serve') rally = { start: s, intents: [] };
    else rally.intents.push(intents);
    if (s.events.some((e) => e.kind === 'dead') && rally.intents.length >= minTicks) return { rally, dead: s };
  }
}

/** Plays a Replay to the end in fixed frames, collecting what it emits. */
function playAll(replay: ReturnType<typeof createReplay>, dt: number) {
  const events: SimEvent[] = [];
  let frames = 0;
  while (!replay.done && frames < 10_000) {
    replay.advance(dt);
    events.push(...replay.events);
    frames++;
  }
  return { events, frames };
}

describe('Fault Replay', () => {
  const { rally, dead } = recordRally(7, 300);

  const clip = { seconds: 2.5, speed: 0.5, hold: 0 };

  it('ends drawing exactly the state the live Rally ended on', () => {
    const replay = createReplay(rally, t, clip);
    playAll(replay, 1 / 60);
    expect(replay.curr).toEqual(dead);
    expect(replay.alpha).toBe(1);
  });

  it('starts 2.5 s before the Fault', () => {
    const replay = createReplay(rally, t, clip);
    expect(replay.alpha).toBe(0);
    expect(dead.tick - replay.prev.tick).toBe(150);
  });

  it('plays the whole Rally when it is shorter than the clip', () => {
    const short = recordRally(7);
    const replay = createReplay(short.rally, t, { ...clip, seconds: 60, speed: 1 });
    expect(replay.prev).toEqual(short.rally.start);
  });

  it('takes the clip length divided by the speed, in real time', () => {
    const replay = createReplay(rally, t, clip);
    const { frames } = playAll(replay, 1 / 60);
    expect(frames).toBeGreaterThanOrEqual(299);
    expect(frames).toBeLessThanOrEqual(301);
  });

  it('holds on the Fault for `hold` seconds before it is done', () => {
    const replay = createReplay(rally, t, { ...clip, hold: 0.5 });
    const { frames } = playAll(replay, 1 / 60);
    expect(frames).toBeGreaterThanOrEqual(329);
    expect(frames).toBeLessThanOrEqual(331);
    expect(replay.curr).toEqual(dead);
  });

  it("emits each replayed Tick's events once, ending with the Fault", () => {
    const replay = createReplay(rally, t, clip);
    const { events } = playAll(replay, 1 / 144);
    const deads = events.filter((e) => e.kind === 'dead');
    expect(deads).toEqual(dead.events.filter((e) => e.kind === 'dead'));
  });

  it('interpolates between neighbouring Ticks', () => {
    const replay = createReplay(rally, t, clip);
    replay.advance(TICK * 2.5); // 1.25 Ticks at half speed
    expect(replay.curr.tick - replay.prev.tick).toBe(1);
    expect(replay.prev.tick).toBe(dead.tick - 149);
    expect(replay.alpha).toBeCloseTo(0.25);
  });

  it('can be skipped', () => {
    const replay = createReplay(rally, t, { ...clip, hold: 0.5 });
    replay.skip();
    expect(replay.done).toBe(true);
  });
});
