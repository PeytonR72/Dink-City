import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTY, createBot } from '../../src/bot/bot';
import { observe } from '../../src/bot/observe';
import { MAX_PREDICT_TICKS, PRESETS, createPredictor, dequantizeIntent, fadeIntent, quantizeIntent, type SnapEvent, type Told } from '../../src/net';
import { createInitialState, step, type Intent, type SideIndex, type SimState } from '../../src/sim';
import { simTuning } from '../../src/tuning';

// The Bot Match below takes a few seconds.
vi.setConfig({ testTimeout: 60_000 });

const SEED = 31;
const START = createInitialState(SEED, PRESETS.quick.config);
const STILL: Intent = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
const RIGHT: Intent = { move: { x: 1, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
const UP: Intent = { move: { x: 0, y: 1 }, aim: { x: 0.5, y: 0 }, shot: null };
const Q_STILL = quantizeIntent(STILL);

/** Steps the plain Sim from `s` with each pair. */
function run(s: SimState, pairs: [Intent, Intent][]) {
  for (const pair of pairs) s = step(s, pair, simTuning);
  return s;
}

const pos = (s: SimState, side: SideIndex) => s.sides[side].players[0].pos;

describe('the predictor', () => {
  it('steps the local Player the moment an Intent is stamped, as the Court will after the wire', () => {
    const p = createPredictor({ local: 0, start: START, tuning: simTuning });
    // A gamepad's 0.3 isn't exact in int8; the Court steps the quantized one.
    const pad: Intent = { move: { x: 0.3, y: -0.71 }, aim: { x: 0, y: 0 }, shot: null };
    for (let t = 0; t < 30; t++) p.stamp(t, pad);
    const wire = dequantizeIntent(quantizeIntent(pad));
    const ticks = (i: Intent, n: number) => Array.from({ length: n }, (): [Intent, Intent] => [i, STILL]);
    expect(p.curr).toEqual(run(START, ticks(wire, 30)));
    expect(p.prev).toEqual(run(START, ticks(wire, 29)));
    expect(p.curr).not.toEqual(run(START, ticks(pad, 30)));
  });

  it("predicts Side 1's own Player when it's the local one", () => {
    const p = createPredictor({ local: 1, start: START, tuning: simTuning });
    p.stamp(0, RIGHT);
    expect(p.curr).toEqual(run(START, [[STILL, RIGHT]]));
  });

  it("fades a skipped Tick's move as the Court fills it", () => {
    const p = createPredictor({ local: 0, start: START, tuning: simTuning });
    p.stamp(0, RIGHT);
    p.stamp(3, UP);
    expect(p.curr).toEqual(run(START, [[RIGHT, STILL], [fadeIntent(RIGHT, 1), STILL], [fadeIntent(RIGHT, 2), STILL], [UP, STILL]]));
  });

  it('re-simulates from a Snapshot through every Tick stamped since, with no correction when it agrees', () => {
    const p = createPredictor({ local: 0, start: START, tuning: simTuning });
    for (let t = 0; t < 8; t++) p.stamp(t, t % 2 ? RIGHT : UP);
    const predicted = p.curr;
    // The Court has stepped Ticks 0..3 with the same Intents, and Side 1 stood still.
    const court = run(START, [[UP, STILL], [RIGHT, STILL], [UP, STILL], [RIGHT, STILL]]);
    const { correction } = p.reconcile({ state: court, last: [quantizeIntent(RIGHT), Q_STILL], events: [] });
    expect(p.curr).toEqual(predicted);
    expect(correction).toEqual({ x: 0, z: 0 });
  });

  it('corrects to the Court when it stepped something else, by how far the local Player moved', () => {
    const p = createPredictor({ local: 0, start: START, tuning: simTuning });
    for (let t = 0; t < 6; t++) p.stamp(t, RIGHT);
    const before = { ...pos(p.curr, 0) };
    // The Court never got Ticks 0 and 1, so it filled them with standing still.
    const court = run(START, [[STILL, STILL], [STILL, STILL]]);
    const { correction } = p.reconcile({ state: court, last: [Q_STILL, Q_STILL], events: [] });
    expect(p.curr).toEqual(run(court, [[RIGHT, STILL], [RIGHT, STILL], [RIGHT, STILL], [RIGHT, STILL]]));
    expect(correction.x).toBeCloseTo(pos(p.curr, 0).x - before.x, 12);
    expect(correction.x).toBeLessThan(0);
  });

  it("guesses the remote Player repeats their last Intent, and takes the truth from each Snapshot", () => {
    const p = createPredictor({ local: 0, start: START, tuning: simTuning });
    const shooting: Intent = { ...RIGHT, aim: { x: 0, y: 1 }, shot: 'drive' };
    const court = run(START, [[STILL, RIGHT]]);
    p.reconcile({ state: court, last: [Q_STILL, quantizeIntent(shooting)], events: [] });
    // No shot in the guess: a press is a one-Tick thing.
    expect(p.guess).toEqual({ ...shooting, shot: null });
    for (let t = 1; t < 5; t++) p.stamp(t, STILL);
    const guessed = { ...RIGHT, aim: { x: 0, y: 1 } };
    expect(p.curr).toEqual(run(court, [[STILL, guessed], [STILL, guessed], [STILL, guessed], [STILL, guessed]]));
    const guessedX = pos(p.curr, 1).x;

    // In truth they turned back. The next Snapshot puts them where they are, and guesses from there.
    const left: Intent = { move: { x: -1, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
    const truth = run(court, [[STILL, left], [STILL, left]]);
    p.reconcile({ state: truth, last: [Q_STILL, quantizeIntent(left)], events: [] });
    expect(p.curr).toEqual(run(truth, [[STILL, left], [STILL, left]]));
    expect(pos(p.curr, 1).x).not.toBeCloseTo(guessedX, 1);
  });

  it('waits for a Snapshot rather than predicting too far ahead of what it has', () => {
    const p = createPredictor({ local: 0, start: START, tuning: simTuning });
    p.stamp(MAX_PREDICT_TICKS + 100, RIGHT);
    expect(p.curr).toBe(START);
    const court = run(START, Array.from({ length: 150 }, (): [Intent, Intent] => [STILL, STILL]));
    p.reconcile({ state: court, last: [Q_STILL, Q_STILL], events: [] });
    expect(p.curr.tick).toBe(MAX_PREDICT_TICKS + 101);
  });

  it('tells the Court events once each, the outcomes always and the predictable ones unless already told', () => {
    const p = createPredictor({ local: 0, start: START, tuning: simTuning });
    const net: SnapEvent = { kind: 'net', pos: { x: 0, y: 0.5, z: 0 }, cord: false, tick: 3 };
    const dead: SnapEvent = { kind: 'dead', reason: 'net', loser: 0, tick: 3 };
    const remoteHit: SnapEvent = { kind: 'hit', side: 1, type: 'drive', variant: 'drive', quality: 1, speed: 10, pos: { x: 0, y: 1, z: -6 }, tick: 2 } as SnapEvent;
    const court = run(START, [[STILL, STILL], [STILL, STILL], [STILL, STILL]]);
    const first = p.reconcile({ state: court, last: [Q_STILL, Q_STILL], events: [remoteHit, net, dead] });
    expect(first.told).toEqual([{ state: court, events: [remoteHit, net, dead] }]);
    // The same net again (a Snapshot resent after a reload, say) isn't told twice.
    expect(p.reconcile({ state: court, last: [Q_STILL, Q_STILL], events: [net] }).told).toEqual([]);
  });
});

/** The ball's flight is the same function of Tick on both ends, so a Bot Match replayed through the predictor tells its
 * local hits on time from the prediction, and never twice when the Court's copy comes. */
describe('the predictor over a Bot Match', () => {
  it('tells each local hit once, on its Tick, and the outcomes only from the Court', () => {
    const local: SideIndex = 0;
    const bots = [createBot(0, SEED + 1, DIFFICULTY.medium, simTuning), createBot(1, SEED + 2, DIFFICULTY.medium, simTuning)] as const;
    // The Court's timeline: every state and the Intents each Tick was stepped with.
    const states: SimState[] = [START];
    const pairs: [Intent, Intent][] = [];
    while (states.at(-1)!.phase !== 'over') {
      const s = states.at(-1)!;
      const pair: [Intent, Intent] = [bots[0].think(observe(s, 0)), bots[1].think(observe(s, 1))];
      pairs.push(pair.map((i) => dequantizeIntent(quantizeIntent(i))) as [Intent, Intent]);
      states.push(step(s, pairs.at(-1)!, simTuning));
    }
    const end = states.length - 1;

    // This client stamps 6 Ticks ahead of the Court and hears it 6 Ticks late, a Snapshot every 2 Ticks.
    const LEAD = 6;
    const DELAY = 6;
    const p = createPredictor({ local, start: START, tuning: simTuning });
    const heard: (SnapEvent & { at: number })[] = [];
    const hear = (told: Told[], at: number) => {
      for (const t of told) heard.push(...t.events.map((e) => ({ ...e, at })));
    };
    let snapped = 0;
    for (let c = 0; c <= end + DELAY; c++) {
      const tick = c + LEAD - 1;
      if (tick < end) hear(p.stamp(tick, pairs[tick]![local]), c);
      const s = c - DELAY;
      if (s > 0 && s <= end && s % 2 === 0) {
        const events = states.slice(snapped + 1, s + 1).flatMap((st) => st.events.map((e) => ({ ...e, tick: st.tick })));
        const last: [ReturnType<typeof quantizeIntent>, ReturnType<typeof quantizeIntent>] = [quantizeIntent(pairs[s - 1]![0]), quantizeIntent(pairs[s - 1]![1])];
        hear(p.reconcile({ state: states[s]!, last, events }).told, c);
        snapped = s;
      }
    }

    const truth = states.flatMap((st) => st.events.map((e) => ({ ...e, tick: st.tick })));
    const key = (e: SnapEvent) => `${e.tick} ${e.kind} ${e.kind === 'hit' ? e.side : ''}`;
    const localHits = truth.filter((e) => e.kind === 'hit' && e.side === local);
    const heardHits = heard.filter((e) => e.kind === 'hit' && e.side === local);
    expect(localHits.length).toBeGreaterThan(20);
    // Every local hit heard once, and heard ahead of the Court: on its Tick in this client's timeline.
    expect(heardHits.map(key)).toEqual(localHits.map(key));
    expect(heardHits.every((e) => e.at === e.tick - LEAD)).toBe(true);
    // Nothing heard twice, and every outcome heard exactly as the Court had it, once its Snapshot came.
    expect(new Set(heard.map(key)).size).toBe(heard.length);
    const outcomes = (es: SnapEvent[]) => es.filter((e) => ['dead', 'rally-won', 'game', 'match'].includes(e.kind)).map(key);
    expect(outcomes(heard)).toEqual(outcomes(truth));
    expect(heard.filter((e) => outcomes([e]).length > 0).every((e) => e.at >= e.tick + DELAY)).toBe(true);
  });
});
