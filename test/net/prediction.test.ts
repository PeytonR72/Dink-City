import { describe, expect, it, vi } from 'vitest';
import { DIFFICULTY, createBot } from '../../src/bot/bot';
import { observe } from '../../src/bot/observe';
import { MAX_PREDICT_TICKS, createPredictor, dequantizeIntent, fadeIntent, onlineConfig, quantizeIntent, type QIntent, type SnapEvent, type Told } from '../../src/net';
import { autoContact, createInitialState, step, type Intent, type SideIndex, type SimState } from '../../src/sim';
import { simTuning } from '../../src/tuning';

// The Bot Match below takes a few seconds.
vi.setConfig({ testTimeout: 60_000 });

const SEED = 31;
const START = createInitialState(SEED, onlineConfig('quick'));
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

/**
 * The Court's timeline of a Bot Match: every state, and the Intents each Tick was stepped with, as clients that call
 * their hits by the `auto` rule send them.
 */
function botMatch() {
  const bots = [createBot(0, SEED + 1, DIFFICULTY.medium, simTuning), createBot(1, SEED + 2, DIFFICULTY.medium, simTuning)] as const;
  const states: SimState[] = [START];
  const pairs: [Intent, Intent][] = [];
  while (states.at(-1)!.phase !== 'over') {
    const s = states.at(-1)!;
    const pair = [bots[0].think(observe(s, 0)), bots[1].think(observe(s, 1))].map((i) => dequantizeIntent(quantizeIntent(i))) as [Intent, Intent];
    const calls = [autoContact(s, pair, 0, simTuning), autoContact(s, pair, 1, simTuning)];
    pairs.push(pair.map((i, side) => (calls[side] ? { ...i, contact: true } : i)) as [Intent, Intent]);
    states.push(step(s, pairs.at(-1)!, simTuning));
  }
  return { states, pairs };
}
const MATCH = botMatch();

/** The Intent an input sampler gives: no Contact, which the predictor calls. */
const sampled = (i: Intent): Intent => ({ move: i.move, aim: i.aim, shot: i.shot });
const lastOf = (pair: [Intent, Intent]): [QIntent, QIntent] => [quantizeIntent(pair[0]), quantizeIntent(pair[1])];
const eventsOf = (states: SimState[]): SnapEvent[] => states.flatMap((st) => st.events.map((e) => ({ ...e, tick: st.tick })));
const rallyHits = (side: SideIndex) =>
  eventsOf(MATCH.states).flatMap((e) => (e.kind === 'hit' && e.side === side && e.variant !== 'serve' ? [e] : []));
const heardHit = (told: Told[], side: SideIndex) => told.some((t) => t.events.some((e) => e.kind === 'hit' && e.side === side));

describe('Reported Contact in the predictor', () => {
  it('reports Contact on exactly the Ticks the Court hits, calling each from the prediction alone', () => {
    const { states, pairs } = MATCH;
    for (const local of [0, 1] as const) {
      // Stamped 6 Ticks ahead of the Snapshots, so each call is made from the prediction, not the Court's state.
      const p = createPredictor({ local, start: START, tuning: simTuning });
      const sent: Intent[] = [];
      for (let tick = 0; tick < pairs.length; tick++) {
        sent.push(p.stamp(tick, sampled(pairs[tick]![local])).intent);
        const s = tick - 6;
        if (s > 0 && s % 2 === 0) p.reconcile({ state: states[s]!, last: lastOf(pairs[s - 1]!), events: [] });
      }
      expect(rallyHits(local).length).toBeGreaterThan(20);
      // Contact and all, each Intent goes as the Court stepped it.
      expect(sent.flatMap((i, tick) => (i.contact ? [tick] : []))).toEqual(pairs.flatMap((pair, tick) => (pair[local].contact ? [tick] : [])));
      expect(sent).toEqual(pairs.map((pair) => pair[local]));
    }
  });

  it('reports nothing when there is no hit to make, and never passes on a `contact` of its own', () => {
    const p = createPredictor({ local: 0, start: START, tuning: simTuning });
    for (let t = 0; t < 30; t++) expect(p.stamp(t, t === 10 ? { ...RIGHT, shot: 'drive' } : RIGHT).intent.contact).toBeUndefined();
    expect(p.stamp(30, { ...RIGHT, contact: true }).intent.contact).toBeUndefined();
  });

  it('guesses the remote Player calls their hits by the same rule', () => {
    // A remote hit by a Player already Committed, on a Tick their Intent is the same as the one before, so the guess
    // has it right.
    const { states, pairs } = MATCH;
    const same = (a: Intent, b: Intent) => JSON.stringify(quantizeIntent({ ...sampled(a), shot: null })) === JSON.stringify(quantizeIntent(sampled(b)));
    const hit = rallyHits(1).find((e) => states[e.tick - 1]!.sides[1].players[0].commit !== null && same(pairs[e.tick - 2]![1], pairs[e.tick - 1]![1]))!;
    expect(hit).toBeDefined();
    const base = hit.tick - 1;
    const p = createPredictor({ local: 0, start: START, tuning: simTuning });
    p.reconcile({ state: states[base]!, last: lastOf(pairs[base - 1]!), events: [] });
    const told: Told[] = [];
    for (let t = base; t < hit.tick + 3; t++) told.push(...p.stamp(t, sampled(pairs[t]![0])).told);
    // The ball flies off as the Court's did, but a remote hit is told only by the Court.
    expect(p.curr.ball).toEqual(states[hit.tick + 3]!.ball);
    expect(heardHit(told, 1)).toBe(false);
  });

  it('corrects a hit the Court rejected once, with no swing heard again', () => {
    // Side 0's first Rally hit, predicted and heard on its Tick. `T` is the Tick it's stepped from.
    const { states, pairs } = MATCH;
    const hit = rallyHits(0)[0]!;
    const T = hit.tick - 1;
    const p = createPredictor({ local: 0, start: START, tuning: simTuning });
    p.reconcile({ state: states[T - 10]!, last: lastOf(pairs[T - 11]!), events: [] });
    const heard: SnapEvent[] = [];
    for (let t = T - 10; t <= T + 8; t++) for (const told of p.stamp(t, sampled(pairs[t]![0])).told) heard.push(...told.events);
    expect(heard.filter((e) => e.kind === 'hit' && e.side === 0).map((e) => e.tick)).toEqual([hit.tick]);

    // A Snapshot from before the hit: the re-simulation hits again on the same Tick, which isn't heard twice.
    const again = p.reconcile({ state: states[T - 2]!, last: lastOf(pairs[T - 3]!), events: [] });
    expect(again.told).toEqual([]);
    expect(p.curr.ball).toEqual(states[T + 9]!.ball);

    // But the Court dropped the report, as one past the window: its ball flew on.
    const flown: SimState[] = [];
    let court = states[T]!;
    for (let t = T; t < T + 6; t++) {
      court = step(court, [t === T ? sampled(pairs[t]![0]) : pairs[t]![0], pairs[t]![1]], simTuning);
      flown.push(court);
    }
    expect(court.ball.lastHitBy).toBe(1);
    const corrected = p.reconcile({ state: court, last: lastOf(pairs[T + 5]!), events: eventsOf(flown) });
    // The prediction takes the Court's unhit ball, and the report, now behind the Snapshot, can't hit it again.
    let truth = court;
    for (let t = T + 6; t <= T + 8; t++) truth = step(truth, pairs[t]!, simTuning);
    expect(p.curr.ball).toEqual(truth.ball);
    expect(heardHit(corrected.told, 0)).toBe(false);
    expect(heardHit(p.reconcile({ state: truth, last: lastOf(pairs[T + 8]!), events: [] }).told, 0)).toBe(false);
  });
});

/** The ball's flight is the same function of Tick on both ends, so a Bot Match replayed through the predictor tells its
 * local hits on time from the prediction, and never twice when the Court's copy comes. */
describe('the predictor over a Bot Match', () => {
  it('tells each local hit once, on its Tick, and the outcomes only from the Court', () => {
    const local: SideIndex = 0;
    const { states, pairs } = MATCH;
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
      if (tick < end) hear(p.stamp(tick, sampled(pairs[tick]![local])).told, c);
      const s = c - DELAY;
      if (s > 0 && s <= end && s % 2 === 0) {
        hear(p.reconcile({ state: states[s]!, last: lastOf(pairs[s - 1]!), events: eventsOf(states.slice(snapped + 1, s + 1)) }).told, c);
        snapped = s;
      }
    }

    const truth = eventsOf(states);
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
